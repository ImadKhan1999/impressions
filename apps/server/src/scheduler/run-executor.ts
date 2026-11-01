import {
  RETRYABLE_ERROR_CODES,
  type DeviceProfile,
  type RunProgress,
  type RunSettings,
  type TestTask,
} from '@impressions/shared';
import type { PendingTask, RunRepository, TaskCompletion } from '../db/repositories/runs.js';
import type { BrowserEngine } from '../engines/browser/browser-engine.js';
import type { HttpRedirectEngine } from '../engines/http/redirect-engine.js';
import type { EngineResult } from '../engines/types.js';
import type { EventBus } from '../events/bus.js';
import { nowIso } from '../lib/async.js';
import { errorMessage } from '../lib/errors.js';
import type { ResolvedProxy } from '../proxies/agents.js';
import type { DomainLimiter } from './domain-limiter.js';
import { TaskQueue } from './task-queue.js';

export interface ExecutorLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface ExecutorDeps {
  runs: RunRepository;
  bus: EventBus;
  limiter: DomainLimiter;
  http: HttpRedirectEngine;
  browser: BrowserEngine;
  logger: ExecutorLogger;
}

export type ExecutorOutcome = 'completed' | 'paused' | 'cancelled' | 'failed';

const REFILL_SIZE = 2000;
const FLUSH_INTERVAL_MS = 300;
const FLUSH_BATCH = 100;
const PROGRESS_INTERVAL_MS = 250;

/** Wakes the scheduling loop when something changes, or after a timeout. */
class Notifier {
  private waiters: (() => void)[] = [];
  notify(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, Math.max(1, Math.min(ms, 60_000)));
      const self = this;
      function done() {
        clearTimeout(t);
        self.waiters = self.waiters.filter((x) => x !== done);
        resolve();
      }
      this.waiters.push(done);
    });
  }
}

/**
 * Drives a single run: streams pending tasks from the database, schedules them
 * under global, per-engine and per-domain limits, persists results in batches
 * and publishes live progress.
 */
export class RunExecutor {
  private readonly abort = new AbortController();
  private stopReason: 'pause' | 'cancel' | null = null;
  private readonly queue = new TaskQueue();
  private readonly notifier = new Notifier();
  private readonly buffer: TaskCompletion[] = [];
  private readonly completedAt: number[] = [];
  private inflight = 0;
  private browserInflight = 0;
  private cursor = 0;
  private exhausted = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private progressTimer: NodeJS.Timeout | null = null;
  private counters = { total: 0, done: 0, success: 0, failed: 0 };
  readonly done: Promise<ExecutorOutcome>;
  private resolveDone!: (o: ExecutorOutcome) => void;

  constructor(
    readonly runId: number,
    private readonly settings: RunSettings,
    private readonly profiles: Map<number, DeviceProfile>,
    private readonly proxy: ResolvedProxy | null,
    private readonly deps: ExecutorDeps,
  ) {
    this.done = new Promise((r) => (this.resolveDone = r));
  }

  start(): void {
    const c = this.deps.runs.refreshCounters(this.runId);
    this.counters = { total: c.total, done: c.done, success: c.success, failed: c.failed };
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    this.progressTimer = setInterval(() => this.emitProgress(), PROGRESS_INTERVAL_MS);
    void this.loop().then(
      (o) => this.finish(o),
      (err) => {
        this.deps.logger.error({ runId: this.runId, err: errorMessage(err) }, 'run executor crashed');
        this.finish('failed', errorMessage(err));
      },
    );
  }

  pause(): void {
    if (!this.stopReason) this.stopReason = 'pause';
    this.abort.abort();
    this.notifier.notify();
  }

  cancel(): void {
    this.stopReason = 'cancel';
    this.abort.abort();
    this.notifier.notify();
  }

  /** Live progress snapshot. */
  progress(): RunProgress {
    const now = Date.now();
    while (this.completedAt.length && this.completedAt[0]! < now - 30_000) this.completedAt.shift();
    const windowSec = Math.min(30, Math.max(1, (now - (this.completedAt[0] ?? now)) / 1000));
    const perMin = this.completedAt.length ? (this.completedAt.length / windowSec) * 60 : 0;
    const remaining = this.counters.total - this.counters.done;
    return {
      runId: this.runId,
      status: 'running',
      totalTasks: this.counters.total,
      doneTasks: this.counters.done,
      successTasks: this.counters.success,
      failedTasks: this.counters.failed,
      runningTasks: this.inflight,
      throughputPerMin: Math.round(perMin * 10) / 10,
      etaSeconds: perMin > 0 ? Math.round((remaining / perMin) * 60) : null,
    };
  }

  private emitProgress(): void {
    this.deps.bus.emit({ type: 'run.progress', progress: this.progress() });
  }

  private refill(): void {
    if (this.exhausted) return;
    const rows = this.deps.runs.fetchPending(this.runId, this.cursor, REFILL_SIZE);
    if (rows.length === 0) {
      this.exhausted = true;
      return;
    }
    for (const r of rows) this.queue.push(r);
    this.cursor = rows[rows.length - 1]!.id;
  }

  private limits() {
    return {
      requestsPerSecond: this.settings.requestsPerSecondPerDomain,
      maxConcurrent: this.settings.maxConcurrentPerDomain,
    };
  }

  private async loop(): Promise<ExecutorOutcome> {
    const limits = this.limits();
    while (!this.abort.signal.aborted) {
      if (this.queue.size < this.settings.concurrency * 4) this.refill();
      if (this.queue.size === 0 && this.exhausted) {
        if (this.inflight === 0) break;
        await this.notifier.wait(1000);
        continue;
      }
      if (this.inflight >= this.settings.concurrency) {
        await this.notifier.wait(1000);
        continue;
      }
      const task = this.queue.next((t) => {
        if (t.engine === 'browser' && this.browserInflight >= this.settings.browserConcurrency) return false;
        return this.deps.limiter.waitTime(t.domain, limits) === 0;
      });
      if (!task) {
        // Sleep until the soonest domain becomes available, or until a task finishes.
        let soonest = 1000;
        for (const d of this.queue.domains().slice(0, 500)) {
          const w = this.deps.limiter.waitTime(d, limits);
          if (w < soonest) soonest = w;
        }
        await this.notifier.wait(Math.max(5, soonest));
        continue;
      }
      if (!this.deps.limiter.tryAcquire(task.domain, limits)) {
        this.queue.unshift(task);
        continue;
      }
      this.inflight++;
      if (task.engine === 'browser') this.browserInflight++;
      void this.execute(task).finally(() => {
        this.inflight--;
        if (task.engine === 'browser') this.browserInflight--;
        this.deps.limiter.release(task.domain);
        this.notifier.notify();
      });
    }
    // Wait for in-flight tasks to observe the abort and return.
    while (this.inflight > 0) await this.notifier.wait(250);
    if (this.stopReason === 'cancel') return 'cancelled';
    if (this.stopReason === 'pause') return 'paused';
    return 'completed';
  }

  private async execute(task: PendingTask): Promise<void> {
    const startedAt = nowIso();
    this.deps.runs.markRunning(task.id);
    const attempts = task.attempts + 1;
    const profile = task.profileId !== null ? (this.profiles.get(task.profileId) ?? null) : null;
    const engine = task.engine === 'browser' ? this.deps.browser : this.deps.http;
    let result: EngineResult;
    try {
      result = await engine.run({
        taskId: task.id,
        runId: this.runId,
        url: task.url,
        profile,
        proxy: this.proxy,
        settings: this.settings,
        signal: this.abort.signal,
      });
    } catch (err) {
      result = {
        status: 'error',
        finalUrl: null,
        finalStatus: null,
        redirectCount: 0,
        totalTimeMs: 0,
        errorCode: 'UNKNOWN',
        errorMessage: errorMessage(err),
        hops: [],
        details: {},
      };
    }

    if (this.abort.signal.aborted) {
      // Interrupted by pause/cancel: the attempt does not count.
      if (this.stopReason === 'pause') this.deps.runs.requeueTask(task.id, { refundAttempt: true });
      return;
    }

    // Retry transport failures only; a response from the site is never re-requested.
    if (result.errorCode && RETRYABLE_ERROR_CODES.includes(result.errorCode) && attempts <= this.settings.retries) {
      this.deps.runs.requeueTask(task.id, { refundAttempt: false });
      this.queue.push({ ...task, attempts });
      return;
    }

    const completion: TaskCompletion = {
      id: task.id,
      status: result.status,
      attempts,
      finalUrl: result.finalUrl,
      finalStatus: result.finalStatus,
      redirectCount: result.redirectCount,
      totalTimeMs: result.totalTimeMs,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      result: result.details,
      startedAt,
      finishedAt: nowIso(),
      hops: result.hops,
    };
    this.buffer.push(completion);
    this.counters.done++;
    if (result.status === 'success') this.counters.success++;
    else this.counters.failed++;
    this.completedAt.push(Date.now());
    if (this.buffer.length >= FLUSH_BATCH) this.flush();

    const event: TestTask = {
      id: task.id,
      runId: this.runId,
      urlId: null,
      url: task.url,
      domain: task.domain,
      profileId: task.profileId,
      profileName: profile?.name ?? null,
      engine: task.engine,
      status: result.status,
      attempts,
      finalUrl: result.finalUrl,
      finalStatus: result.finalStatus,
      redirectCount: result.redirectCount,
      totalTimeMs: result.totalTimeMs,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      result: null,
      startedAt,
      finishedAt: completion.finishedAt,
    };
    this.deps.bus.emit({ type: 'task.completed', runId: this.runId, task: event });
  }

  private flush(): void {
    if (!this.buffer.length) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      this.deps.runs.completeTasks(batch);
    } catch (err) {
      this.deps.logger.error({ runId: this.runId, err: errorMessage(err) }, 'failed to persist task results');
      // Keep results for the next flush rather than losing them.
      this.buffer.unshift(...batch);
    }
  }

  private finish(outcome: ExecutorOutcome, error?: string): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.flush();
    if (outcome === 'cancelled') this.deps.runs.cancelPendingTasks(this.runId);
    else this.deps.runs.resetRunningTasks(this.runId);
    this.deps.runs.refreshCounters(this.runId);
    this.resolveDone(error ? 'failed' : outcome);
    if (error) this.deps.logger.error({ runId: this.runId, error }, 'run failed');
  }
}
