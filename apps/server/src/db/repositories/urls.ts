import type { Paginated, UrlEntry, UrlList } from '@impressions/shared';
import type { DB } from '../connection.js';
import { nowIso } from '../../lib/async.js';

interface ListRow {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  url_count: number;
  domain_count: number;
}

interface UrlRow {
  id: number;
  list_id: number;
  url: string;
  domain: string;
  label: string | null;
  tags: string;
  created_at: string;
}

const listTo = (r: ListRow): UrlList => ({
  id: r.id,
  name: r.name,
  description: r.description,
  urlCount: r.url_count,
  domainCount: r.domain_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const urlTo = (r: UrlRow): UrlEntry => ({
  id: r.id,
  listId: r.list_id,
  url: r.url,
  domain: r.domain,
  label: r.label,
  tags: JSON.parse(r.tags) as string[],
  createdAt: r.created_at,
});

export interface NewUrl {
  url: string;
  domain: string;
  label: string | null;
  tags: string[];
}

const LIST_SELECT = `
  SELECT l.*,
    (SELECT COUNT(*) FROM urls u WHERE u.list_id = l.id) AS url_count,
    (SELECT COUNT(DISTINCT domain) FROM urls u WHERE u.list_id = l.id) AS domain_count
  FROM url_lists l`;

export class UrlRepository {
  constructor(private readonly db: DB) {}

  lists(): UrlList[] {
    return (this.db.prepare(`${LIST_SELECT} ORDER BY l.updated_at DESC`).all() as ListRow[]).map(listTo);
  }

  getList(id: number): UrlList | null {
    const r = this.db.prepare(`${LIST_SELECT} WHERE l.id = ?`).get(id) as ListRow | undefined;
    return r ? listTo(r) : null;
  }

  createList(name: string, description: string | null): UrlList {
    const now = nowIso();
    const info = this.db
      .prepare('INSERT INTO url_lists (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(name, description, now, now);
    return this.getList(Number(info.lastInsertRowid))!;
  }

  updateList(id: number, name: string, description: string | null): UrlList | null {
    const info = this.db
      .prepare('UPDATE url_lists SET name = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(name, description, nowIso(), id);
    return info.changes ? this.getList(id) : null;
  }

  touchList(id: number): void {
    this.db.prepare('UPDATE url_lists SET updated_at = ? WHERE id = ?').run(nowIso(), id);
  }

  deleteList(id: number): boolean {
    return this.db.prepare('DELETE FROM url_lists WHERE id = ?').run(id).changes > 0;
  }

  listUrls(listId: number, opts: { page: number; pageSize: number; q?: string; domain?: string }): Paginated<UrlEntry> {
    const where = ['list_id = ?'];
    const params: unknown[] = [listId];
    if (opts.q) {
      where.push(`(url LIKE ? ESCAPE '\\' OR label LIKE ? ESCAPE '\\')`);
      const like = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like);
    }
    if (opts.domain) {
      where.push('domain = ?');
      params.push(opts.domain);
    }
    const w = where.join(' AND ');
    const total = (this.db.prepare(`SELECT COUNT(*) AS c FROM urls WHERE ${w}`).get(...params) as { c: number }).c;
    const rows = this.db
      .prepare(`SELECT * FROM urls WHERE ${w} ORDER BY id LIMIT ? OFFSET ?`)
      .all(...params, opts.pageSize, (opts.page - 1) * opts.pageSize) as UrlRow[];
    return { items: rows.map(urlTo), total, page: opts.page, pageSize: opts.pageSize };
  }

  /** Batched insert; returns how many were new (duplicates are ignored by the unique index). */
  insertUrls(listId: number, urls: NewUrl[]): number {
    const now = nowIso();
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO urls (list_id, url, domain, label, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    let inserted = 0;
    const BATCH = 5000;
    for (let i = 0; i < urls.length; i += BATCH) {
      const batch = urls.slice(i, i + BATCH);
      this.db.transaction(() => {
        for (const u of batch) {
          inserted += stmt.run(listId, u.url, u.domain, u.label, JSON.stringify(u.tags), now).changes;
        }
      })();
    }
    if (inserted) this.touchList(listId);
    return inserted;
  }

  deleteUrls(listId: number, ids: number[]): number {
    let n = 0;
    this.db.transaction(() => {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        n += this.db
          .prepare(`DELETE FROM urls WHERE list_id = ? AND id IN (${chunk.map(() => '?').join(',')})`)
          .run(listId, ...chunk).changes;
      }
    })();
    if (n) this.touchList(listId);
    return n;
  }

  deleteAllUrls(listId: number): number {
    const n = this.db.prepare('DELETE FROM urls WHERE list_id = ?').run(listId).changes;
    if (n) this.touchList(listId);
    return n;
  }

  countUrls(listId?: number): number {
    const row = (
      listId === undefined
        ? this.db.prepare('SELECT COUNT(*) AS c FROM urls').get()
        : this.db.prepare('SELECT COUNT(*) AS c FROM urls WHERE list_id = ?').get(listId)
    ) as { c: number };
    return row.c;
  }

  countLists(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM url_lists').get() as { c: number }).c;
  }
}
