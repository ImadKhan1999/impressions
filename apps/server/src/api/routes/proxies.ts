import type { FastifyInstance } from 'fastify';
import { proxyTestSchema } from '@impressions/shared';
import type { AppContext } from '../../context.js';
import { parseId } from '../errors.js';

export function proxyRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/proxies', async () => ctx.proxies.list());

  app.post('/api/proxies', async (req, reply) => reply.status(201).send(ctx.proxies.create(req.body as never)));

  app.get('/api/proxies/:id', async (req) => ctx.proxies.get(parseId((req.params as { id: string }).id)));

  app.patch('/api/proxies/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const p = ctx.proxies.update(id, req.body as never);
    // Browsers launched with the old settings must not be reused.
    await ctx.pool.closeForProxy(id);
    return p;
  });

  app.delete('/api/proxies/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id);
    ctx.proxies.delete(id);
    await ctx.pool.closeForProxy(id);
    return reply.status(204).send();
  });

  app.post('/api/proxies/:id/test', async (req) => {
    const { url } = proxyTestSchema.parse(req.body ?? {});
    return ctx.proxies.test(parseId((req.params as { id: string }).id), url);
  });
}
