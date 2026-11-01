import type { FastifyInstance } from 'fastify';
import { LIMITS, urlAddSchema, urlDeleteSchema, urlQuerySchema } from '@impressions/shared';
import type { AppContext } from '../../context.js';
import { badRequest } from '../../lib/errors.js';
import { parseId } from '../errors.js';

export function urlRoutes(app: FastifyInstance, ctx: AppContext): void {
  const listId = (req: { params: unknown }) => parseId((req.params as { id: string }).id);

  app.get('/api/url-lists', async () => ctx.urls.lists());
  app.post('/api/url-lists', async (req, reply) => reply.status(201).send(ctx.urls.createList(req.body)));
  app.get('/api/url-lists/:id', async (req) => ctx.urls.getList(listId(req)));
  app.patch('/api/url-lists/:id', async (req) => ctx.urls.updateList(listId(req), req.body));
  app.delete('/api/url-lists/:id', async (req, reply) => {
    ctx.urls.deleteList(listId(req));
    return reply.status(204).send();
  });

  app.get('/api/url-lists/:id/urls', async (req) => ctx.urls.listUrls(listId(req), urlQuerySchema.parse(req.query)));

  /** Paste URLs as text (same rules as a TXT file). */
  app.post('/api/url-lists/:id/urls', { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const { text } = urlAddSchema.parse(req.body);
    return ctx.urls.import(listId(req), text, { format: 'txt' });
  });

  app.post('/api/url-lists/:id/urls/delete', async (req) => ctx.urls.deleteUrls(listId(req), urlDeleteSchema.parse(req.body)));

  /** Multipart upload of a .txt or .csv file. */
  app.post('/api/url-lists/:id/import', async (req) => {
    const id = listId(req);
    const file = await req.file({ limits: { fileSize: LIMITS.maxImportBytes, files: 1 } });
    if (!file) throw badRequest('Attach a .txt or .csv file');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw badRequest(`File exceeds ${LIMITS.maxImportBytes / 1024 / 1024} MB`);
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const fmt = fields.format?.value;
    return ctx.urls.import(id, buf, {
      filename: file.filename,
      format: fmt === 'csv' || fmt === 'txt' ? fmt : undefined,
    });
  });
}
