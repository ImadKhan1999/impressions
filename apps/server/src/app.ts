import path from 'node:path';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { LIMITS } from '@impressions/shared';
import type { AppContext } from './context.js';
import { registerErrorHandler } from './api/errors.js';
import { profileRoutes } from './api/routes/profiles.js';
import { proxyRoutes } from './api/routes/proxies.js';
import { runRoutes } from './api/routes/runs.js';
import { systemRoutes } from './api/routes/system.js';
import { urlRoutes } from './api/routes/urls.js';

export interface BuildAppOptions {
  /** A pino logger instance to share with Fastify. Omit for a silent app (tests). */
  logger?: FastifyBaseLogger;
}

export async function buildApp(ctx: AppContext, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    ...(opts.logger ? { loggerInstance: opts.logger } : { logger: false }),
    bodyLimit: 8 * 1024 * 1024,
    // Long-running exports and SSE must not be cut off.
    requestTimeout: 0,
    genReqId: () => Math.random().toString(36).slice(2, 10),
  });

  registerErrorHandler(app);
  await app.register(multipart, { limits: { fileSize: LIMITS.maxImportBytes, files: 1, fields: 5 } });

  // Basic hardening for a local web app.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    return payload;
  });

  // Reject cross-site state-changing requests (DNS rebinding / CSRF from other local pages).
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const origin = req.headers.origin;
    if (!origin) return;
    try {
      const o = new URL(origin);
      const host = req.headers.host ?? '';
      if (o.host !== host) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Cross-origin request rejected' } });
      }
    } catch {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Invalid origin' } });
    }
  });

  systemRoutes(app, ctx);
  profileRoutes(app, ctx);
  proxyRoutes(app, ctx);
  urlRoutes(app, ctx);
  runRoutes(app, ctx);

  const spaRoot = ctx.config.webDistDir ? path.resolve(ctx.config.webDistDir) : null;
  if (spaRoot) {
    await app.register(fastifyStatic, { root: spaRoot, prefix: '/', wildcard: false, index: ['index.html'] });
  }
  app.setNotFoundHandler((req, reply) => {
    // SPA fallback: unknown non-API GET routes serve the app shell.
    if (spaRoot && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.type('text/html').sendFile('index.html', spaRoot);
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } });
  });

  return app;
}
