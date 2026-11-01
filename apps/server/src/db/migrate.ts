import type Database from 'better-sqlite3';
import * as m001 from './migrations/001_init.js';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Ordered list of migrations. Append new ones; never edit applied ones. */
export const MIGRATIONS: Migration[] = [{ version: 1, name: m001.name, sql: m001.sql }];

export function migrate(db: Database.Database): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  const newlyApplied: number[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    })();
    newlyApplied.push(m.version);
  }
  return newlyApplied;
}
