import type {
  DashboardStats,
  DeviceProfile,
  ErrorCode,
  HopType,
  Paginated,
  RedirectHop,
  RunMode,
  RunSettings,
  RunStatus,
  RunSummary,
  TaskEngine,
  TaskResultDetails,
  TaskStatus,
  TestRun,
  TestTask,
} from '@impressions/shared';
import { TASK_STATUSES } from '@impressions/shared';
import type { DB } from '../connection.js';
import { nowIso } from '../../lib/async.js';

interface RunRow {
  id: number;
  name: string;
  status: RunStatus;
  mode: RunMode;
  url_list_id: number | null;
  url_list_name: string | null;
  proxy_id: number | null;
  proxy_name: string | null;
  settings: string;
  profile_count: number;
  total_tasks: number;
  done_tasks: number;
  success_tasks: number;
  failed_tasks: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface TaskRow {
  id: number;
  run_id: number;
  url_id: number | null;
  url: string;
  domain: string;
  profile_id: number | null;
  profile_name: string | null;
  engine: TaskEngine;
  status: TaskStatus;
  attempts: number;
  final_url: string | null;
  final_status: number | null;
  redirect_count: number | null;
  total_time_ms: number | null;
  error_code: ErrorCode | null;
  error_message: string | null;
  result: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface HopRow {
  seq: number;
  url: string;
  status_code: number | null;
  location: string | null;
  hop_type: HopType;
  method: string;
  response_time_ms: number | null;
  remote_address: string | null;
  headers: string | null;
  error: string | null;
}

const runTo = (r: RunRow): TestRun => ({
  id: r.id,
  name: r.name,
  status: r.status,
  mode: r.mode,
  urlListId: r.url_list_id,
  urlListName: r.url_list_name,
  proxyId: r.proxy_id,
  proxyName: r.proxy_name,
  settings: JSON.parse(r.settings) as RunSettings,
  profileCount: r.profile_count,
  totalTasks: r.total_tasks,
  doneTasks: r.done_tasks,
  successTasks: r.success_tasks,
  failedTasks: r.failed_tasks,
  error: r.error,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export const taskTo = (r: TaskRow): TestTask => ({
  id: r.id,
  runId: r.run_id,
  urlId: r.url_id,
  url: r.url,
  domain: r.domain,
  profileId: r.profile_id,
  profileName: r.profile_name,
  engine: r.engine,
  status: r.status,
  attempts: r.attempts,
  finalUrl: r.final_url,
  finalStatus: r.final_status,
  redirectCount: r.redirect_count,
  totalTimeMs: r.total_time_ms,
  errorCode: r.error_code,
  errorMessage: r.error_message,
  result: r.result ? (JSON.parse(r.result) as TaskResultDetails) : null,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

const hopTo = (r: HopRow): RedirectHop => ({
  seq: r.seq,
  url: r.url,
  statusCode: r.status_code,
  location: r.location,
  hopType: r.hop_type,
  method: r.method,
  responseTimeMs: r.response_time_ms,
  remoteAddress: r.remote_address,
  headers: r.headers ? (JSON.parse(r.headers) as Record<string, string>) : null,
  error: r.error,
});

const RUN_SELECT = `
  SELECT r.*, l.name AS url_list_name, p.name AS proxy_name,
    (SELECT COUNT(*) FROM test_run_profiles rp WHERE rp.run_id = r.id) AS profile_count
  FROM test_runs r
  LEFT JOIN url_lists l ON l.id = r.url_list_id
  LEFT JOIN proxies p ON p.id = r.proxy_id`;

const TASK_SELECT = `
  SELECT t.*, json_extract(rp.snapshot, '$.name') AS profile_name
  FROM test_tasks t
  LEFT JOIN test_run_profiles rp ON rp.run_id = t.run_id AND rp.profile_id = t.profile_id`;

/** Minimal task data the scheduler needs to execute a task. */
export interface PendingTask {
  id: number;
  url: string;
  domain: string;
  profileId: number | null;
  engine: TaskEngine;
  attempts: number;
}

export interface TaskCompletion {
  id: number;
  status: Exclude<TaskStatus, 'pending' | 'running'>;
  attempts: number;
  finalUrl: string | null;
  finalStatus: number | null;
  redirectCount: number | null;
  totalTimeMs: number | null;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  result: TaskResultDetails | null;
  startedAt: string;
  finishedAt: string;
  hops: RedirectHop[];
}

export interface RunCounters {
  total: number;
  done: number;
  success: number;
  failed: number;
  running: number;
  pending: number;
}

export class RunRepository {
  constructor(private readonly db: DB) {}

  /* ------------------------------ runs ------------------------------ */

  list(opts: { page: number; pageSize: number; status?: RunStatus[]; q?: string }): Paginated<TestRun> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.status?.length) {
      where.push(`r.status IN (${opts.status.map(() => '?').join(',')})`);
      params.push(...opts.status);
    }
    if (opts.q) {
      where.push(`r.name LIKE ? ESCAPE '\\'`);
      params.push(`%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS c FROM test_runs r ${w}`).get(...params) as { c: number }).c;
    const rows = this.db
      .prepare(`${RUN_SELECT} ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`)
      .all(...params, opts.pageSize, (opts.page - 1) * opts.pageSize) as RunRow[];
    return { items: rows.map(runTo), total, page: opts.page, pageSize: opts.pageSize };
  }

  get(id: number): TestRun | null {
    const r = this.db.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(id) as RunRow | undefined;
    return r ? runTo(r) : null;
  }

  byStatus(statuses: RunStatus[]): TestRun[] {
    return (
      this.db
        .prepare(`${RUN_SELECT} WHERE r.status IN (${statuses.map(() => '?').join(',')}) ORDER BY r.id`)
        .all(...statuses) as RunRow[]
    ).map(runTo);
  }

  /**
   * Creates a run, snapshots its profiles and plans every task in one transaction.
   * Each (url, profile, engine) combination appears exactly once.
   */
  createWithTasks(input: {
    name: string;
    mode: RunMode;
    urlListId: number;
    proxyId: number | null;
    settings: RunSettings;
    profiles: DeviceProfile[];
    status: RunStatus;
  }): TestRun {
    const engines: TaskEngine[] = input.mode === 'both' ? ['http', 'browser'] : [input.mode];
    const now = nowIso();
    const id = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO test_runs (name, status, mode, url_list_id, proxy_id, settings, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.name, input.status, input.mode, input.urlListId, input.proxyId, JSON.stringify(input.settings), now);
      const runId = Number(info.lastInsertRowid);
      const snap = this.db.prepare('INSERT INTO test_run_profiles (run_id, profile_id, snapshot) VALUES (?, ?, ?)');
      for (const p of input.profiles) snap.run(runId, p.id, JSON.stringify(p));

      const plan = this.db.prepare(
        `INSERT INTO test_tasks (run_id, url_id, url, domain, profile_id, engine, status)
         SELECT ?, u.id, u.url, u.domain, rp.profile_id, ?, 'pending'
         FROM urls u CROSS JOIN test_run_profiles rp
         WHERE u.list_id = ? AND rp.run_id = ?
         ORDER BY u.id, rp.profile_id`,
      );
      let total = 0;
      for (const engine of engines) total += plan.run(runId, engine, input.urlListId, runId).changes;
      this.db.prepare('UPDATE test_runs SET total_tasks = ? WHERE id = ?').run(total, runId);
      return runId;
    })();
    return this.get(id)!;
  }

  /** Copies an existing run's plan into a new run (same URLs/profiles/settings). */
  duplicate(sourceId: number, name: string, status: RunStatus): TestRun {
    const now = nowIso();
    const id = this.db.transaction(() => {
      const src = this.db.prepare('SELECT * FROM test_runs WHERE id = ?').get(sourceId) as RunRow;
      const info = this.db
        .prepare(
          `INSERT INTO test_runs (name, status, mode, url_list_id, proxy_id, settings, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(name, status, src.mode, src.url_list_id, src.proxy_id, src.settings, now);
      const runId = Number(info.lastInsertRowid);
      this.db
        .prepare(
          `INSERT INTO test_run_profiles (run_id, profile_id, snapshot)
           SELECT ?, profile_id, snapshot FROM test_run_profiles WHERE run_id = ?`,
        )
        .run(runId, sourceId);
      const total = this.db
        .prepare(
          `INSERT INTO test_tasks (run_id, url_id, url, domain, profile_id, engine, status)
           SELECT ?, url_id, url, domain, profile_id, engine, 'pending' FROM test_tasks WHERE run_id = ? ORDER BY id`,
        )
        .run(runId, sourceId).changes;
      this.db.prepare('UPDATE test_runs SET total_tasks = ? WHERE id = ?').run(total, runId);
      return runId;
    })();
    return this.get(id)!;
  }

  setStatus(id: number, status: RunStatus, extra: { error?: string | null; started?: boolean; finished?: boolean } = {}): void {
    const sets = ['status = @status'];
    if (extra.error !== undefined) sets.push('error = @error');
    if (extra.started) sets.push('started_at = COALESCE(started_at, @now)');
    if (extra.finished) sets.push('finished_at = @now');
    else if (status === 'running' || status === 'queued') sets.push('finished_at = NULL');
    this.db
      .prepare(`UPDATE test_runs SET ${sets.join(', ')} WHERE id = @id`)
      .run({ id, status, error: extra.error ?? null, now: nowIso() });
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM test_runs WHERE id = ?').run(id).changes > 0;
  }

  idsOlderThan(iso: string): number[] {
    return (
      this.db
        .prepare(`SELECT id FROM test_runs WHERE created_at < ? AND status IN ('completed','cancelled','failed','draft')`)
        .all(iso) as { id: number }[]
    ).map((r) => r.id);
  }

  profileSnapshots(runId: number): Map<number, DeviceProfile> {
    const rows = this.db.prepare('SELECT profile_id, snapshot FROM test_run_profiles WHERE run_id = ?').all(runId) as {
      profile_id: number;
      snapshot: string;
    }[];
    return new Map(rows.map((r) => [r.profile_id, JSON.parse(r.snapshot) as DeviceProfile]));
  }

  /** Recomputes and persists the denormalised counters from task rows. */
  refreshCounters(runId: number): RunCounters {
    const c = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(status IN ('success','failed','error','cancelled')),0) AS done,
           COALESCE(SUM(status = 'success'),0) AS success,
           COALESCE(SUM(status IN ('failed','error')),0) AS failed,
           COALESCE(SUM(status = 'running'),0) AS running,
           COALESCE(SUM(status = 'pending'),0) AS pending
         FROM test_tasks WHERE run_id = ?`,
      )
      .get(runId) as RunCounters;
    this.db
      .prepare('UPDATE test_runs SET total_tasks=?, done_tasks=?, success_tasks=?, failed_tasks=? WHERE id=?')
      .run(c.total, c.done, c.success, c.failed, runId);
    return c;
  }

  /* ------------------------------ tasks ----------------------------- */

  fetchPending(runId: number, afterId: number, limit: number): PendingTask[] {
    return (
      this.db
        .prepare(
          `SELECT id, url, domain, profile_id, engine, attempts FROM test_tasks
           WHERE run_id = ? AND status = 'pending' AND id > ? ORDER BY id LIMIT ?`,
        )
        .all(runId, afterId, limit) as {
        id: number;
        url: string;
        domain: string;
        profile_id: number | null;
        engine: TaskEngine;
        attempts: number;
      }[]
    ).map((r) => ({ id: r.id, url: r.url, domain: r.domain, profileId: r.profile_id, engine: r.engine, attempts: r.attempts }));
  }

  markRunning(id: number): void {
    this.db
      .prepare(`UPDATE test_tasks SET status='running', started_at=?, attempts=attempts+1 WHERE id=? AND status='pending'`)
      .run(nowIso(), id);
  }

  /** Persists a batch of completed tasks and their hops in one transaction. */
  completeTasks(items: TaskCompletion[]): void {
    if (!items.length) return;
    const upd = this.db.prepare(
      `UPDATE test_tasks SET status=@status, attempts=@attempts, final_url=@finalUrl, final_status=@finalStatus,
         redirect_count=@redirectCount, total_time_ms=@totalTimeMs, error_code=@errorCode, error_message=@errorMessage,
         result=@result, started_at=@startedAt, finished_at=@finishedAt WHERE id=@id`,
    );
    const delHops = this.db.prepare('DELETE FROM redirect_hops WHERE task_id = ?');
    const insHop = this.db.prepare(
      `INSERT INTO redirect_hops (task_id, seq, url, status_code, location, hop_type, method, response_time_ms, remote_address, headers, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      for (const t of items) {
        upd.run({ ...t, result: t.result ? JSON.stringify(t.result) : null });
        delHops.run(t.id);
        for (const h of t.hops) {
          insHop.run(
            t.id,
            h.seq,
            h.url,
            h.statusCode,
            h.location,
            h.hopType,
            h.method,
            h.responseTimeMs,
            h.remoteAddress,
            h.headers ? JSON.stringify(h.headers) : null,
            h.error,
          );
        }
      }
    })();
  }

  /** Returns a task to the queue (retry, or interrupted by pause). */
  requeueTask(id: number, opts: { refundAttempt: boolean }): void {
    this.db
      .prepare(
        `UPDATE test_tasks SET status='pending', started_at=NULL ${opts.refundAttempt ? ', attempts = MAX(attempts-1,0)' : ''} WHERE id=?`,
      )
      .run(id);
  }

  resetRunningTasks(runId?: number): number {
    return runId === undefined
      ? this.db.prepare(`UPDATE test_tasks SET status='pending', started_at=NULL WHERE status='running'`).run().changes
      : this.db
          .prepare(`UPDATE test_tasks SET status='pending', started_at=NULL WHERE status='running' AND run_id=?`)
          .run(runId).changes;
  }

  cancelPendingTasks(runId: number): number {
    return this.db
      .prepare(`UPDATE test_tasks SET status='cancelled', finished_at=? WHERE run_id=? AND status IN ('pending','running')`)
      .run(nowIso(), runId).changes;
  }

  getTask(id: number): TestTask | null {
    const r = this.db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as TaskRow | undefined;
    return r ? taskTo(r) : null;
  }

  hops(taskId: number): RedirectHop[] {
    return (this.db.prepare('SELECT * FROM redirect_hops WHERE task_id = ? ORDER BY seq').all(taskId) as HopRow[]).map(
      hopTo,
    );
  }

  hopsForTasks(taskIds: number[]): Map<number, RedirectHop[]> {
    const out = new Map<number, RedirectHop[]>();
    for (let i = 0; i < taskIds.length; i += 500) {
      const chunk = taskIds.slice(i, i + 500);
      const rows = this.db
        .prepare(
          `SELECT task_id, * FROM redirect_hops WHERE task_id IN (${chunk.map(() => '?').join(',')}) ORDER BY task_id, seq`,
        )
        .all(...chunk) as (HopRow & { task_id: number })[];
      for (const r of rows) {
        const list = out.get(r.task_id) ?? [];
        list.push(hopTo(r));
        out.set(r.task_id, list);
      }
    }
    return out;
  }

  listTasks(
    runId: number,
    o: {
      page: number;
      pageSize: number;
      status?: TaskStatus[];
      engine?: TaskEngine[];
      profileId?: number;
      domain?: string;
      errorCode?: string;
      q?: string;
      sort: 'id' | 'time' | 'redirects' | 'status';
      order: 'asc' | 'desc';
    },
  ): Paginated<TestTask> {
    const where = ['t.run_id = ?'];
    const params: unknown[] = [runId];
    if (o.status?.length) {
      where.push(`t.status IN (${o.status.map(() => '?').join(',')})`);
      params.push(...o.status);
    }
    if (o.engine?.length) {
      where.push(`t.engine IN (${o.engine.map(() => '?').join(',')})`);
      params.push(...o.engine);
    }
    if (o.profileId) {
      where.push('t.profile_id = ?');
      params.push(o.profileId);
    }
    if (o.domain) {
      where.push('t.domain = ?');
      params.push(o.domain);
    }
    if (o.errorCode) {
      where.push('t.error_code = ?');
      params.push(o.errorCode);
    }
    if (o.q) {
      const like = `%${o.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(`(t.url LIKE ? ESCAPE '\\' OR t.final_url LIKE ? ESCAPE '\\')`);
      params.push(like, like);
    }
    const w = where.join(' AND ');
    const sortCol = { id: 't.id', time: 't.total_time_ms', redirects: 't.redirect_count', status: 't.final_status' }[o.sort];
    const dir = o.order === 'desc' ? 'DESC' : 'ASC';
    const total = (this.db.prepare(`SELECT COUNT(*) AS c FROM test_tasks t WHERE ${w}`).get(...params) as { c: number }).c;
    const rows = this.db
      .prepare(`${TASK_SELECT} WHERE ${w} ORDER BY ${sortCol} ${dir} NULLS LAST, t.id ${dir} LIMIT ? OFFSET ?`)
      .all(...params, o.pageSize, (o.page - 1) * o.pageSize) as TaskRow[];
    return { items: rows.map(taskTo), total, page: o.page, pageSize: o.pageSize };
  }

  *iterateTasks(runId: number): Generator<TestTask> {
    for (const r of this.db.prepare(`${TASK_SELECT} WHERE t.run_id = ? ORDER BY t.id`).iterate(runId)) {
      yield taskTo(r as TaskRow);
    }
  }

  /* ----------------------------- analytics -------------------------- */

  summary(runId: number): RunSummary {
    const byStatusRows = this.db
      .prepare('SELECT status, COUNT(*) AS c FROM test_tasks WHERE run_id = ? GROUP BY status')
      .all(runId) as { status: TaskStatus; c: number }[];
    const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const r of byStatusRows) byStatus[r.status] = r.c;

    const byErrorCode = this.db
      .prepare(
        `SELECT error_code AS code, COUNT(*) AS count FROM test_tasks WHERE run_id = ? AND error_code IS NOT NULL
         GROUP BY error_code ORDER BY count DESC LIMIT 20`,
      )
      .all(runId) as { code: string; count: number }[];

    const byFinalStatus = this.db
      .prepare(
        `SELECT final_status AS status, COUNT(*) AS count FROM test_tasks
         WHERE run_id = ? AND status IN ('success','failed','error') GROUP BY final_status ORDER BY count DESC LIMIT 20`,
      )
      .all(runId) as { status: number | null; count: number }[];

    const byEngine = this.db
      .prepare(
        `SELECT engine, COUNT(*) AS count, COALESCE(SUM(status='success'),0) AS success,
           CAST(AVG(total_time_ms) AS INTEGER) AS avgTimeMs
         FROM test_tasks WHERE run_id = ? AND status NOT IN ('pending','running','cancelled') GROUP BY engine`,
      )
      .all(runId) as RunSummary['byEngine'];

    const byFormFactor = this.db
      .prepare(
        `SELECT COALESCE(json_extract(rp.snapshot,'$.formFactor'),'unknown') AS formFactor, COUNT(*) AS count,
           COALESCE(SUM(t.status='success'),0) AS success, ROUND(AVG(t.redirect_count), 2) AS avgRedirects
         FROM test_tasks t LEFT JOIN test_run_profiles rp ON rp.run_id = t.run_id AND rp.profile_id = t.profile_id
         WHERE t.run_id = ? AND t.status NOT IN ('pending','running','cancelled') GROUP BY 1 ORDER BY count DESC`,
      )
      .all(runId) as RunSummary['byFormFactor'];

    const finalUrls = this.db
      .prepare(`SELECT final_url FROM test_tasks WHERE run_id = ? AND final_url IS NOT NULL`)
      .pluck()
      .iterate(runId) as Iterable<string>;
    const domainCounts = new Map<string, number>();
    for (const u of finalUrls) {
      let host: string;
      try {
        host = new URL(u).hostname;
      } catch {
        continue;
      }
      domainCounts.set(host, (domainCounts.get(host) ?? 0) + 1);
    }
    const topFinalDomains = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([domain, count]) => ({ domain, count }));

    const slowest = (
      this.db
        .prepare(
          `${TASK_SELECT} WHERE t.run_id = ? AND t.total_time_ms IS NOT NULL ORDER BY t.total_time_ms DESC LIMIT 10`,
        )
        .all(runId) as TaskRow[]
    ).map((r) => ({ taskId: r.id, url: r.url, totalTimeMs: r.total_time_ms!, profileName: r.profile_name }));

    const agg = this.db
      .prepare(
        `SELECT CAST(AVG(total_time_ms) AS INTEGER) AS avgTime, ROUND(AVG(redirect_count),2) AS avgRedirects,
           COUNT(total_time_ms) AS n
         FROM test_tasks WHERE run_id = ? AND total_time_ms IS NOT NULL`,
      )
      .get(runId) as { avgTime: number | null; avgRedirects: number | null; n: number };
    let p95: number | null = null;
    if (agg.n > 0) {
      const offset = Math.min(agg.n - 1, Math.floor(agg.n * 0.95));
      p95 =
        (this.db
          .prepare(
            `SELECT total_time_ms FROM test_tasks WHERE run_id = ? AND total_time_ms IS NOT NULL
             ORDER BY total_time_ms LIMIT 1 OFFSET ?`,
          )
          .pluck()
          .get(runId, offset) as number | undefined) ?? null;
    }

    return {
      runId,
      byStatus,
      byErrorCode,
      byFinalStatus,
      byEngine,
      byFormFactor,
      topFinalDomains,
      slowest,
      avgTimeMs: agg.avgTime,
      p95TimeMs: p95,
      avgRedirects: agg.avgRedirects,
    };
  }

  dashboard(): Omit<DashboardStats, 'urls' | 'urlLists' | 'profiles' | 'enabledProfiles' | 'proxies'> {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const runs = (this.db.prepare('SELECT COUNT(*) AS c FROM test_runs').get() as { c: number }).c;
    const activeRuns = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM test_runs WHERE status IN ('queued','running')`).get() as { c: number }
    ).c;
    const last7 = this.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(status='success'),0) AS ok FROM test_tasks
         WHERE finished_at >= ? AND status IN ('success','failed','error')`,
      )
      .get(since) as { n: number; ok: number };
    const dailyRows = this.db
      .prepare(
        `SELECT substr(finished_at,1,10) AS date,
           COALESCE(SUM(status='success'),0) AS success,
           COALESCE(SUM(status='failed'),0) AS failed,
           COALESCE(SUM(status='error'),0) AS error
         FROM test_tasks WHERE finished_at >= ? AND status IN ('success','failed','error')
         GROUP BY 1 ORDER BY 1`,
      )
      .all(since) as DashboardStats['daily'];
    const byDate = new Map(dailyRows.map((d) => [d.date, d]));
    const daily: DashboardStats['daily'] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      daily.push(byDate.get(date) ?? { date, success: 0, failed: 0, error: 0 });
    }
    const topErrors = this.db
      .prepare(
        `SELECT error_code AS code, COUNT(*) AS count FROM test_tasks
         WHERE finished_at >= ? AND error_code IS NOT NULL GROUP BY error_code ORDER BY count DESC LIMIT 8`,
      )
      .all(since) as DashboardStats['topErrors'];
    return {
      runs,
      activeRuns,
      tasksLast7Days: last7.n,
      successRateLast7Days: last7.n ? last7.ok / last7.n : null,
      daily,
      topErrors,
    };
  }
}
