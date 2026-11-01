import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import {
  profileBulkSchema,
  profileFilterSchema,
  profileImportSchema,
  profileQuerySchema,
  profileUpdateSchema,
  userAgentPreviewSchema,
} from '@impressions/shared';
import type { AppContext } from '../../context.js';
import { parseId } from '../errors.js';

export function profileRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/profiles', async (req) => ctx.profiles.list(profileQuerySchema.parse(req.query)));

  app.get('/api/profiles/facets', async (req) => {
    const q = profileQuerySchema.partial().parse(req.query);
    const { page: _p, pageSize: _s, sort: _o, ...filter } = q;
    return ctx.profiles.facets(filter);
  });

  /** Counts profiles matching a filter (used by the run wizard to preview task counts). */
  app.post('/api/profiles/count', async (req) => {
    const filter = profileFilterSchema.parse(req.body ?? {});
    return { count: ctx.repos.profiles.count(filter) };
  });

  app.get('/api/profiles/catalog', async () => ctx.profiles.catalog());

  app.post('/api/profiles/user-agent', async (req) => {
    const i = userAgentPreviewSchema.parse(req.body);
    return ctx.profiles.previewUserAgent({
      platform: i.platform,
      formFactor: i.formFactor,
      modelCode: i.model && /^SM-/i.test(i.model) ? i.model : null,
      osVersion: i.osVersion,
      browser: i.browser,
      browserVersion: i.browserVersion,
    });
  });

  app.get('/api/profiles/export', async (_req, reply) => {
    const gen = ctx.profiles.export();
    function* body() {
      yield '{"profiles":[';
      let first = true;
      for (const p of gen) {
        const { id: _id, createdAt: _c, updatedAt: _u, source: _s, ...rest } = p;
        yield (first ? '\n' : ',\n') + JSON.stringify(rest);
        first = false;
      }
      yield '\n]}\n';
    }
    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="device-profiles-${new Date().toISOString().slice(0, 10)}.json"`);
    return reply.send(Readable.from(body()));
  });

  app.post('/api/profiles/import', { bodyLimit: 64 * 1024 * 1024 }, async (req) => {
    const input = profileImportSchema.parse(req.body);
    return ctx.profiles.import(input.profiles, input.onConflict);
  });

  app.post('/api/profiles/generate', async (req) => ctx.profiles.generate(req.body as never));

  app.post('/api/profiles/bulk', async (req) => {
    const { selection, action } = profileBulkSchema.parse(req.body);
    return ctx.profiles.bulk(selection, action);
  });

  app.get('/api/profiles/:id', async (req) => ctx.profiles.get(parseId((req.params as { id: string }).id)));

  app.post('/api/profiles', async (req, reply) => reply.status(201).send(ctx.profiles.create(req.body as never)));

  app.patch('/api/profiles/:id', async (req) =>
    ctx.profiles.update(parseId((req.params as { id: string }).id), profileUpdateSchema.parse(req.body)),
  );

  app.delete('/api/profiles/:id', async (req, reply) => {
    ctx.profiles.delete(parseId((req.params as { id: string }).id));
    return reply.status(204).send();
  });
}
