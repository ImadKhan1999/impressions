import {
  LIMITS,
  urlListInputSchema,
  urlListUpdateSchema,
  type ImportReport,
  type UrlList,
} from '@impressions/shared';
import type { UrlRepository } from '../db/repositories/urls.js';
import type { EventBus } from '../events/bus.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { parseUrlFile, type ParseOptions } from './parser.js';

export class UrlService {
  constructor(
    private readonly repo: UrlRepository,
    private readonly bus: EventBus,
  ) {}

  lists(): UrlList[] {
    return this.repo.lists();
  }

  getList(id: number): UrlList {
    const l = this.repo.getList(id);
    if (!l) throw notFound('URL list', id);
    return l;
  }

  createList(raw: unknown): UrlList {
    const input = urlListInputSchema.parse(raw);
    try {
      return this.repo.createList(input.name, input.description ?? null);
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) throw conflict(`A list named "${input.name}" already exists`);
      throw e;
    }
  }

  updateList(id: number, raw: unknown): UrlList {
    const patch = urlListUpdateSchema.parse(raw);
    const cur = this.getList(id);
    try {
      const l = this.repo.updateList(id, patch.name ?? cur.name, patch.description !== undefined ? patch.description ?? null : cur.description);
      if (!l) throw notFound('URL list', id);
      return l;
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) throw conflict(`A list named "${patch.name}" already exists`);
      throw e;
    }
  }

  deleteList(id: number): void {
    if (!this.repo.deleteList(id)) throw notFound('URL list', id);
    this.bus.emit({ type: 'urls.changed', listId: id });
  }

  listUrls(listId: number, q: { page: number; pageSize: number; q?: string; domain?: string }) {
    this.getList(listId);
    return this.repo.listUrls(listId, q);
  }

  /** Imports TXT/CSV content (or pasted text) into a list, de-duplicating by normalised URL. */
  import(listId: number, content: Buffer | string, opts: ParseOptions = {}): ImportReport {
    this.getList(listId);
    const size = typeof content === 'string' ? Buffer.byteLength(content) : content.length;
    if (size > LIMITS.maxImportBytes) {
      throw new AppError('FILE_TOO_LARGE', `Import files are limited to ${LIMITS.maxImportBytes / 1024 / 1024} MB`, 413);
    }
    if (size === 0) throw badRequest('The file is empty');
    const parsed = parseUrlFile(content, opts);
    const inserted = this.repo.insertUrls(
      listId,
      parsed.entries.map((e) => ({ url: e.url, domain: e.domain, label: e.label, tags: e.tags })),
    );
    const report: ImportReport = {
      format: parsed.format,
      totalLines: parsed.totalLines,
      accepted: parsed.entries.length,
      inserted,
      duplicates: parsed.duplicatesInFile + (parsed.entries.length - inserted),
      rejected: parsed.rejectedTotal,
      rejects: parsed.rejects,
      rejectsTruncated: parsed.rejectedTotal > parsed.rejects.length,
    };
    if (inserted) this.bus.emit({ type: 'urls.changed', listId });
    return report;
  }

  deleteUrls(listId: number, sel: { ids: number[] } | { all: true }): { deleted: number } {
    this.getList(listId);
    const deleted = 'all' in sel ? this.repo.deleteAllUrls(listId) : this.repo.deleteUrls(listId, sel.ids);
    if (deleted) this.bus.emit({ type: 'urls.changed', listId });
    return { deleted };
  }

  countUrls(listId?: number): number {
    return this.repo.countUrls(listId);
  }

  countLists(): number {
    return this.repo.countLists();
  }
}
