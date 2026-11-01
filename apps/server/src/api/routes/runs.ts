import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { exportQuerySchema, runQuerySchema, taskQuerySchema, type TaskDetail } from '@impressions/shared';
import type { AppContext } from '../../context.js';
import { notFound } from '../../lib/errors.js';
import { csvReport, htmlReport, jsonReport } from '../../reports/index.js';
import { parseId } from '../errors.js';

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'run';

export function runRoutes(app: FastifyInstance, ctx: AppContext): void {
  const runId = (req: { params: unknown }) => parseId((req.params as { id: string }).id);

  app.get('/api/runs', async (req) => {
    const q = runQuerySchema.parse(req.query);
    return ctx.repos.runs.list(q);
  });

  app.post('/api/runs', async (req, reply) => reply.status(201).send(ctx.runs.create(req.body as never)));

  app.get('/api/runs/:id', async (req) => {
    const id = runId(req);
    return { run: ctx.runs.get(id), progress: ctx.runs.progress(id) };
  });

  app.delete('/api/runs/:id', async (req, reply) => {
    ctx.runs.delete(runId(req));
    return reply.status(204).send();
  });

  app.post('/api/runs/:id/start', async (req) => ctx.runs.start(runId(req)));
  app.post('/api/runs/:id/resume', async (req) => ctx.runs.start(runId(req)));
  app.post('/api/runs/:id/pause', async (req) => ctx.runs.pause(runId(req)));
  app.post('/api/runs/:id/cancel', async (req) => ctx.runs.cancel(runId(req)));
  app.post('/api/runs/:id/duplicate', async (req, reply) => reply.status(201).send(ctx.runs.duplicate(runId(req))));

  app.get('/api/runs/:id/summary', async (req) => {
    const id = runId(req);
    ctx.runs.get(id);
    return ctx.repos.runs.summary(id);
  });

  app.get('/api/runs/:id/tasks', async (req) => {
    const id = runId(req);
    ctx.runs.get(id);
    return ctx.repos.runs.listTasks(id, taskQuerySchema.parse(req.query));
  });

  app.get('/api/runs/:id/export', async (req, reply) => {
    const id = runId(req);
    const run = ctx.runs.get(id);
    const { format } = exportQuerySchema.parse(req.query);
    const base = `${safeName(run.name)}-${id}`;
    if (format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${base}.csv"`);
      return reply.send(Readable.from(csvReport(ctx.repos.runs, id)));
    }
    const summary = ctx.repos.runs.summary(id);
    if (format === 'json') {
      reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="${base}.json"`);
      return reply.send(Readable.from(jsonReport(ctx.repos.runs, run, summary)));
    }
    reply.header('content-type', 'text/html; charset=utf-8').header('content-disposition', `attachment; filename="${base}.html"`);
    return reply.send(Readable.from(htmlReport(ctx.repos.runs, run, summary)));
  });

  app.get('/api/tasks/:id', async (req): Promise<TaskDetail> => {
    const id = parseId((req.params as { id: string }).id);
    const task = ctx.repos.runs.getTask(id);
    if (!task) throw notFound('Task', id);
    const profile = task.profileId ? (ctx.repos.runs.profileSnapshots(task.runId).get(task.profileId) ?? null) : null;
    return { ...task, hops: ctx.repos.runs.hops(id), profile };
  });

  /** Serves screenshots. Paths are validated to stay inside the artifacts directory. */
  app.get('/api/artifacts/:runId/:file', async (req, reply) => {
    const { runId: r, file } = req.params as { runId: string; file: string };
    const rid = parseId(r);
    if (!/^\d+\.(jpg|png)$/.test(file)) throw notFound('Artifact');
    const full = path.join(ctx.config.artifactsDir, String(rid), file);
    if (!full.startsWith(path.resolve(ctx.config.artifactsDir)) || !fs.existsSync(full)) throw notFound('Artifact');
    reply.header('content-type', file.endsWith('.png') ? 'image/png' : 'image/jpeg').header('cache-control', 'private, max-age=86400');
    return reply.send(fs.createReadStream(full));
  });
}
