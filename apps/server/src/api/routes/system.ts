import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { appSettingsSchema, appSettingsUpdateSchema, type DashboardStats, type ServerEvent, type SystemInfo } from '@impressions/shared';
import type { AppContext } from '../../context.js';
import { BrowserPool } from '../../engines/browser/browser-pool.js';

export function systemRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async () => ({ ok: true, version: ctx.config.version, time: new Date().toISOString() }));

  app.get('/api/stats', async (): Promise<DashboardStats> => ({
    urls: ctx.urls.countUrls(),
    urlLists: ctx.urls.countLists(),
    profiles: ctx.profiles.countAll(),
    enabledProfiles: ctx.profiles.countEnabled(),
    proxies: ctx.proxies.count(),
    ...ctx.repos.runs.dashboard(),
  }));

  app.get('/api/system', async (): Promise<SystemInfo> => {
    let dbSizeBytes = 0;
    for (const f of [ctx.config.dbPath, `${ctx.config.dbPath}-wal`]) {
      try {
        dbSizeBytes += fs.statSync(f).size;
      } catch {
        /* missing WAL is fine */
      }
    }
    return {
      version: ctx.config.version,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      dataDir: ctx.config.dataDir,
      dbSizeBytes,
      browsers: BrowserPool.installed(),
      browserSessions: ctx.pool.status,
      installCommand: 'npm run setup',
    };
  });

  app.get('/api/active', async () => ctx.runs.activeProgress());

  app.get('/api/settings', async () => ctx.repos.settings.get());

  app.put('/api/settings', async (req) => {
    const patch = appSettingsUpdateSchema.parse(req.body);
    const next = appSettingsSchema.parse({ ...ctx.repos.settings.get(), ...patch });
    const saved = ctx.repos.settings.set(next);
    ctx.pool.configure({
      headless: saved.headless,
      maxSessions: saved.maxBrowserSessions,
      idleMs: saved.browserIdleSeconds * 1000,
    });
    return saved;
  });

  /** Server-sent events stream for live dashboards. Optional ?runId= filter. */
  app.get('/api/events', (req, reply) => {
    const runFilter = Number((req.query as { runId?: string }).runId) || null;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const send = (e: ServerEvent) => {
      if (runFilter) {
        const rid =
          e.type === 'run.updated' ? e.run.id : e.type === 'run.progress' ? e.progress.runId : 'runId' in e ? e.runId : null;
        if (rid !== null && rid !== runFilter) return;
      } else if (e.type === 'task.completed') {
        // The global stream carries progress only; per-task events go to run-specific streams.
        return;
      }
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    const unsubscribe = ctx.bus.subscribe(send);
    const ping = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15_000);
    const cleanup = () => {
      clearInterval(ping);
      unsubscribe();
    };
    req.raw.on('close', cleanup);
    res.on('error', cleanup);
  });
}
