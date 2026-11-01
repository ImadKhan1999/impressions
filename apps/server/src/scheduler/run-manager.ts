import fs from 'node:fs';
import path from 'node:path';
import {
  LIMITS,
  runCreateSchema,
  runSettingsSchema,
  type RunCreateInput,
  type RunProgress,
  type RunStatus,
  type TestRun,
} from '@impressions/shared';
import type { ProfileRepository } from '../db/repositories/profiles.js';
import type { RunRepository } from '../db/repositories/runs.js';
import type { SettingsRepository } from '../db/repositories/settings.js';
import type { UrlRepository } from '../db/repositories/urls.js';
import type { EventBus } from '../events/bus.js';
import { AppError, badRequest, conflict, errorMessage, notFound } from '../lib/errors.js';
import { executionEngine } from '../profiles/engine-map.js';
import type { ProfileService } from '../profiles/service.js';
import { playwrightProxy } from '../proxies/agents.js';
import type { ProxyService } from '../proxies/service.js';
import { RunExecutor, type ExecutorDeps } from './run-executor.js';

export interface RunManagerDeps extends Omit<ExecutorDeps, 'runs'> {
  runs: RunRepository;
  profiles: ProfileRepository;
  profileService: ProfileService;
  urls: UrlRepository;
  proxies: ProxyService;
  settings: SettingsRepository;
  artifactsDir: string;
}

/**
 * Owns run lifecycles: creation and planning, start/pause/resume/cancel,
 * a global cap on concurrently executing runs (others wait as `queued`),
 * crash recovery and clean shutdown.
 */
export class RunManager {
  private readonly executors = new Map<number, RunExecutor>();
  private shuttingDown = false;

  constructor(private readonly d: RunManagerDeps) {}

  /** Runs interrupted by a crash or restart are paused, never auto-resumed. */
  recover(): number {
    const interrupted = this.d.runs.byStatus(['running', 'queued']);
    this.d.runs.resetRunningTasks();
    for (const r of interrupted) {
      this.d.runs.setStatus(r.id, 'paused', { error: 'Interrupted by an application restart. Resume to continue.' });
    }
    return interrupted.length;
  }

  isProxyInUse(proxyId: number): boolean {
    return this.d.runs.byStatus(['queued', 'running', 'paused']).some((r) => r.proxyId === proxyId);
  }

  get(id: number): TestRun {
    const r = this.d.runs.get(id);
    if (!r) throw notFound('Run', id);
    return r;
  }

  progress(id: number): RunProgress | null {
    return this.executors.get(id)?.progress() ?? null;
  }

  activeProgress(): RunProgress[] {
    return [...this.executors.values()].map((e) => e.progress());
  }

  create(raw: RunCreateInput): TestRun {
    const input = runCreateSchema.parse(raw);
    // Re-parse settings so hard limits are always applied server-side.
    const settings = runSettingsSchema.parse(input.settings);

    const list = this.d.urls.getList(input.urlListId);
    if (!list) throw notFound('URL list', input.urlListId);
    if (list.urlCount === 0) throw badRequest(`URL list "${list.name}" is empty`);

    const selection =
      'filter' in input.profiles
        ? { filter: { ...input.profiles.filter, enabled: input.profiles.filter.enabled ?? true } }
        : input.profiles;
    const ids = this.d.profileService.resolveSelection(selection, LIMITS.maxProfilesPerRun + 1);
    if (ids.length === 0) throw badRequest('Select at least one device profile');
    if (ids.length > LIMITS.maxProfilesPerRun) {
      throw badRequest(`A run can use at most ${LIMITS.maxProfilesPerRun.toLocaleString()} profiles`);
    }
    const profiles = this.d.profiles.getMany(ids);
    const engines = input.mode === 'both' ? 2 : 1;
    const totalTasks = list.urlCount * profiles.length * engines;
    if (totalTasks > LIMITS.maxTasksPerRun) {
      throw badRequest(
        `This run would create ${totalTasks.toLocaleString()} tasks; the limit is ${LIMITS.maxTasksPerRun.toLocaleString()}. Select fewer profiles or URLs.`,
      );
    }

    if (input.proxyId !== null) {
      const proxy = this.d.proxies.resolve(input.proxyId);
      if (input.mode !== 'http') {
        const strategy = this.d.settings.get().engineStrategy;
        const engines = new Set(profiles.map((p) => executionEngine(p.engine, strategy)));
        for (const e of engines) {
          const check = playwrightProxy(proxy, e);
          if (!check.ok) throw new AppError('PROXY_UNSUPPORTED', check.reason, 400);
        }
      }
    }

    const run = this.d.runs.createWithTasks({
      name: input.name,
      mode: input.mode,
      urlListId: input.urlListId,
      proxyId: input.proxyId,
      settings,
      profiles,
      status: 'draft',
    });
    this.d.bus.emit({ type: 'run.updated', run });
    if (input.start) return this.start(run.id);
    return run;
  }

  duplicate(id: number): TestRun {
    const src = this.get(id);
    const run = this.d.runs.duplicate(id, `${src.name} (copy)`, 'draft');
    this.d.bus.emit({ type: 'run.updated', run });
    return run;
  }

  start(id: number): TestRun {
    const run = this.get(id);
    if (!['draft', 'paused'].includes(run.status)) {
      throw conflict(`Run is ${run.status}; only draft or paused runs can be started`);
    }
    if (this.shuttingDown) throw conflict('The application is shutting down');
    this.setStatus(id, 'queued', { error: null });
    this.pump();
    return this.get(id);
  }

  pause(id: number): TestRun {
    const run = this.get(id);
    if (run.status === 'queued') {
      this.setStatus(id, 'paused');
      return this.get(id);
    }
    const ex = this.executors.get(id);
    if (run.status !== 'running' || !ex) throw conflict(`Run is ${run.status}; only running runs can be paused`);
    ex.pause();
    return this.get(id);
  }

  async cancel(id: number): Promise<TestRun> {
    const run = this.get(id);
    if (['completed', 'cancelled', 'failed'].includes(run.status)) throw conflict(`Run is already ${run.status}`);
    const ex = this.executors.get(id);
    if (ex) {
      ex.cancel();
      await ex.done;
    } else {
      this.d.runs.cancelPendingTasks(id);
      this.d.runs.refreshCounters(id);
      this.setStatus(id, 'cancelled', { finished: true });
    }
    return this.get(id);
  }

  delete(id: number): void {
    const run = this.get(id);
    if (run.status === 'running' || run.status === 'queued') throw conflict('Pause or cancel the run before deleting it');
    this.d.runs.delete(id);
    fs.rmSync(path.join(this.d.artifactsDir, String(id)), { recursive: true, force: true });
    this.d.bus.emit({ type: 'run.deleted', runId: id });
  }

  /** Deletes finished runs older than the retention window (0 = keep forever). */
  applyRetention(): number {
    const days = this.d.settings.get().retentionDays;
    if (!days) return 0;
    const ids = this.d.runs.idsOlderThan(new Date(Date.now() - days * 86_400_000).toISOString());
    for (const id of ids) {
      try {
        this.delete(id);
      } catch (e) {
        this.d.logger.warn({ runId: id, err: errorMessage(e) }, 'retention delete failed');
      }
    }
    return ids.length;
  }

  private setStatus(id: number, status: RunStatus, extra: Parameters<RunRepository['setStatus']>[2] = {}): void {
    this.d.runs.setStatus(id, status, extra);
    const run = this.d.runs.get(id);
    if (run) this.d.bus.emit({ type: 'run.updated', run });
  }

  /** Starts queued runs while there is capacity. */
  private pump(): void {
    if (this.shuttingDown) return;
    const max = this.d.settings.get().maxConcurrentRuns;
    const queued = this.d.runs.byStatus(['queued']);
    for (const run of queued) {
      if (this.executors.size >= max) break;
      if (this.executors.has(run.id)) continue;
      this.launch(run);
    }
  }

  private launch(run: TestRun): void {
    let proxy = null;
    try {
      if (run.proxyId !== null) proxy = this.d.proxies.resolve(run.proxyId);
    } catch (e) {
      this.setStatus(run.id, 'failed', { error: errorMessage(e), finished: true });
      return;
    }
    const profiles = this.d.runs.profileSnapshots(run.id);
    const settings = runSettingsSchema.parse(run.settings);
    const ex = new RunExecutor(run.id, settings, profiles, proxy, {
      runs: this.d.runs,
      bus: this.d.bus,
      limiter: this.d.limiter,
      http: this.d.http,
      browser: this.d.browser,
      logger: this.d.logger,
    });
    this.executors.set(run.id, ex);
    this.setStatus(run.id, 'running', { started: true, error: null });
    this.d.logger.info({ runId: run.id, tasks: run.totalTasks }, 'run started');
    ex.start();
    void ex.done.then((outcome) => {
      this.executors.delete(run.id);
      if (outcome === 'completed') this.setStatus(run.id, 'completed', { finished: true });
      else if (outcome === 'cancelled') this.setStatus(run.id, 'cancelled', { finished: true });
      else if (outcome === 'paused') this.setStatus(run.id, 'paused');
      else this.setStatus(run.id, 'failed', { error: 'The run stopped unexpectedly. See server logs.', finished: true });
      const p = ex.progress();
      this.d.bus.emit({ type: 'run.progress', progress: { ...p, status: this.get(run.id).status, runningTasks: 0 } });
      this.d.logger.info({ runId: run.id, outcome }, 'run finished');
      this.pump();
    });
  }

  /** Pause everything that is running so it can be resumed after restart. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const running = [...this.executors.values()];
    for (const ex of running) ex.pause();
    await Promise.all(running.map((e) => e.done));
    for (const r of this.d.runs.byStatus(['queued'])) this.d.runs.setStatus(r.id, 'paused');
  }
}
