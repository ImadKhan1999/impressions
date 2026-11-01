import type {
  BrowserEngineName,
  DeviceProfile,
  FacetCount,
  Paginated,
  ProfileFacets,
  ProfileFilter,
  ProfileQuery,
  ProfileSource,
} from '@impressions/shared';
import type { DB } from '../connection.js';
import { nowIso } from '../../lib/async.js';

interface ProfileRow {
  id: number;
  slug: string;
  name: string;
  platform: DeviceProfile['platform'];
  form_factor: DeviceProfile['formFactor'];
  vendor: string | null;
  model: string | null;
  os_version: string;
  browser: DeviceProfile['browser'];
  browser_version: string;
  engine: BrowserEngineName;
  user_agent: string;
  client_hints: string | null;
  viewport_width: number;
  viewport_height: number;
  screen_width: number;
  screen_height: number;
  device_scale_factor: number;
  is_mobile: number;
  has_touch: number;
  locale: string;
  timezone: string;
  tags: string;
  source: ProfileSource;
  enabled: number;
  created_at: string;
  updated_at: string;
}

/** A fully resolved profile ready to be written (no id/timestamps). */
export type NewProfile = Omit<DeviceProfile, 'id' | 'createdAt' | 'updatedAt'>;

export function rowToProfile(r: ProfileRow): DeviceProfile {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    platform: r.platform,
    formFactor: r.form_factor,
    vendor: r.vendor,
    model: r.model,
    osVersion: r.os_version,
    browser: r.browser,
    browserVersion: r.browser_version,
    engine: r.engine,
    userAgent: r.user_agent,
    clientHints: r.client_hints ? (JSON.parse(r.client_hints) as Record<string, string>) : null,
    viewportWidth: r.viewport_width,
    viewportHeight: r.viewport_height,
    screenWidth: r.screen_width,
    screenHeight: r.screen_height,
    deviceScaleFactor: r.device_scale_factor,
    isMobile: !!r.is_mobile,
    hasTouch: !!r.has_touch,
    locale: r.locale,
    timezone: r.timezone,
    tags: JSON.parse(r.tags) as string[],
    source: r.source,
    enabled: !!r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toParams(p: NewProfile) {
  return {
    slug: p.slug,
    name: p.name,
    platform: p.platform,
    form_factor: p.formFactor,
    vendor: p.vendor ?? null,
    model: p.model ?? null,
    os_version: p.osVersion,
    browser: p.browser,
    browser_version: p.browserVersion,
    engine: p.engine,
    user_agent: p.userAgent,
    client_hints: p.clientHints ? JSON.stringify(p.clientHints) : null,
    viewport_width: p.viewportWidth,
    viewport_height: p.viewportHeight,
    screen_width: p.screenWidth,
    screen_height: p.screenHeight,
    device_scale_factor: p.deviceScaleFactor,
    is_mobile: p.isMobile ? 1 : 0,
    has_touch: p.hasTouch ? 1 : 0,
    locale: p.locale,
    timezone: p.timezone,
    tags: JSON.stringify(p.tags ?? []),
    source: p.source,
    enabled: p.enabled ? 1 : 0,
  };
}

const COLUMNS = [
  'slug',
  'name',
  'platform',
  'form_factor',
  'vendor',
  'model',
  'os_version',
  'browser',
  'browser_version',
  'engine',
  'user_agent',
  'client_hints',
  'viewport_width',
  'viewport_height',
  'screen_width',
  'screen_height',
  'device_scale_factor',
  'is_mobile',
  'has_touch',
  'locale',
  'timezone',
  'tags',
  'source',
  'enabled',
] as const;

/** Builds a parameterised WHERE clause for a profile filter. */
export function buildProfileWhere(f: ProfileFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const inList = (col: string, values: readonly string[] | undefined) => {
    if (!values || values.length === 0) return;
    clauses.push(`${col} IN (${values.map(() => '?').join(',')})`);
    params.push(...values);
  };
  inList('platform', f.platform);
  inList('form_factor', f.formFactor);
  inList('browser', f.browser);
  inList('engine', f.engine);
  inList('source', f.source);
  if (f.enabled !== undefined) {
    clauses.push('enabled = ?');
    params.push(f.enabled ? 1 : 0);
  }
  if (f.q) {
    for (const term of f.q.split(/\s+/).filter(Boolean).slice(0, 8)) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      clauses.push(
        `(name LIKE ? ESCAPE '\\' OR user_agent LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')`,
      );
      params.push(like, like, like, like);
    }
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const SORTS: Record<ProfileQuery['sort'], string> = {
  name: 'name COLLATE NOCASE ASC, id ASC',
  platform: 'platform ASC, form_factor ASC, name COLLATE NOCASE ASC',
  browser: 'browser ASC, browser_version DESC, name COLLATE NOCASE ASC',
  updated: 'updated_at DESC, id DESC',
};

export class ProfileRepository {
  constructor(private readonly db: DB) {}

  list(q: ProfileQuery): Paginated<DeviceProfile> {
    const { sql, params } = buildProfileWhere(q);
    const total = (this.db.prepare(`SELECT COUNT(*) AS c FROM device_profiles ${sql}`).get(...params) as { c: number })
      .c;
    const rows = this.db
      .prepare(`SELECT * FROM device_profiles ${sql} ORDER BY ${SORTS[q.sort]} LIMIT ? OFFSET ?`)
      .all(...params, q.pageSize, (q.page - 1) * q.pageSize) as ProfileRow[];
    return { items: rows.map(rowToProfile), total, page: q.page, pageSize: q.pageSize };
  }

  count(filter: ProfileFilter = {}): number {
    const { sql, params } = buildProfileWhere(filter);
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM device_profiles ${sql}`).get(...params) as { c: number }).c;
  }

  idsByFilter(filter: ProfileFilter, limit: number): number[] {
    const { sql, params } = buildProfileWhere(filter);
    return (
      this.db.prepare(`SELECT id FROM device_profiles ${sql} ORDER BY id LIMIT ?`).all(...params, limit) as {
        id: number;
      }[]
    ).map((r) => r.id);
  }

  facets(filter: ProfileFilter = {}): ProfileFacets {
    const { sql, params } = buildProfileWhere(filter);
    const facet = <T extends string>(col: string): FacetCount<T>[] =>
      this.db
        .prepare(`SELECT ${col} AS value, COUNT(*) AS count FROM device_profiles ${sql} GROUP BY ${col} ORDER BY count DESC`)
        .all(...params) as FacetCount<T>[];
    const totals = this.db
      .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(enabled),0) AS enabled FROM device_profiles ${sql}`)
      .get(...params) as { total: number; enabled: number };
    return {
      total: totals.total,
      enabled: totals.enabled,
      platform: facet('platform'),
      formFactor: facet('form_factor'),
      browser: facet('browser'),
      engine: facet('engine'),
      source: facet('source'),
    };
  }

  get(id: number): DeviceProfile | null {
    const r = this.db.prepare('SELECT * FROM device_profiles WHERE id = ?').get(id) as ProfileRow | undefined;
    return r ? rowToProfile(r) : null;
  }

  getMany(ids: number[]): DeviceProfile[] {
    const out: DeviceProfile[] = [];
    // SQLite has a bound-parameter limit; chunk large id lists.
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = this.db
        .prepare(`SELECT * FROM device_profiles WHERE id IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk) as ProfileRow[];
      out.push(...rows.map(rowToProfile));
    }
    return out;
  }

  slugExists(slug: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM device_profiles WHERE slug = ?').get(slug);
  }

  existingSlugs(slugs: string[]): Set<string> {
    const out = new Set<string>();
    for (let i = 0; i < slugs.length; i += 500) {
      const chunk = slugs.slice(i, i + 500);
      const rows = this.db
        .prepare(`SELECT slug FROM device_profiles WHERE slug IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk) as { slug: string }[];
      for (const r of rows) out.add(r.slug);
    }
    return out;
  }

  insert(p: NewProfile): DeviceProfile {
    const now = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO device_profiles (${COLUMNS.join(',')}, created_at, updated_at)
         VALUES (${COLUMNS.map((c) => '@' + c).join(',')}, @now, @now)`,
      )
      .run({ ...toParams(p), now });
    return this.get(Number(info.lastInsertRowid))!;
  }

  /**
   * Inserts many profiles in one transaction.
   * `onConflict = 'skip'` ignores rows whose slug exists, 'overwrite' updates them.
   */
  insertMany(profiles: NewProfile[], onConflict: 'skip' | 'overwrite' = 'skip'): { created: number; updated: number; skipped: number } {
    const now = nowIso();
    const insert = this.db.prepare(
      `INSERT INTO device_profiles (${COLUMNS.join(',')}, created_at, updated_at)
       VALUES (${COLUMNS.map((c) => '@' + c).join(',')}, @now, @now)
       ON CONFLICT(slug) DO ${
         onConflict === 'overwrite'
           ? `UPDATE SET ${COLUMNS.filter((c) => c !== 'slug')
               .map((c) => `${c} = excluded.${c}`)
               .join(', ')}, updated_at = excluded.updated_at`
           : 'NOTHING'
       }`,
    );
    const exists = this.db.prepare('SELECT 1 FROM device_profiles WHERE slug = ?');
    let created = 0;
    let updated = 0;
    let skipped = 0;
    this.db.transaction(() => {
      for (const p of profiles) {
        const had = !!exists.get(p.slug);
        const info = insert.run({ ...toParams(p), now });
        if (!had && info.changes > 0) created++;
        else if (had && info.changes > 0) updated++;
        else skipped++;
      }
    })();
    return { created, updated, skipped };
  }

  update(id: number, p: NewProfile): DeviceProfile | null {
    const sets = COLUMNS.map((c) => `${c} = @${c}`).join(', ');
    const info = this.db
      .prepare(`UPDATE device_profiles SET ${sets}, updated_at = @now WHERE id = @id`)
      .run({ ...toParams(p), now: nowIso(), id });
    return info.changes ? this.get(id) : null;
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM device_profiles WHERE id = ?').run(id).changes > 0;
  }

  setEnabledByIds(ids: number[], enabled: boolean): number {
    let n = 0;
    const now = nowIso();
    this.db.transaction(() => {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        n += this.db
          .prepare(`UPDATE device_profiles SET enabled = ?, updated_at = ? WHERE id IN (${chunk.map(() => '?').join(',')})`)
          .run(enabled ? 1 : 0, now, ...chunk).changes;
      }
    })();
    return n;
  }

  deleteByIds(ids: number[]): number {
    let n = 0;
    this.db.transaction(() => {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        n += this.db.prepare(`DELETE FROM device_profiles WHERE id IN (${chunk.map(() => '?').join(',')})`).run(...chunk)
          .changes;
      }
    })();
    return n;
  }

  /**
   * Streams profiles (for export) in keyset pages, so other queries can run
   * between pages while the response is being written.
   */
  *iterate(filter: ProfileFilter = {}): Generator<DeviceProfile> {
    const { sql, params } = buildProfileWhere(filter);
    const where = sql ? `${sql} AND id > ?` : 'WHERE id > ?';
    let last = 0;
    for (;;) {
      const rows = this.db
        .prepare(`SELECT * FROM device_profiles ${where} ORDER BY id LIMIT 1000`)
        .all(...params, last) as ProfileRow[];
      if (!rows.length) return;
      for (const r of rows) yield rowToProfile(r);
      last = rows[rows.length - 1]!.id;
    }
  }
}
