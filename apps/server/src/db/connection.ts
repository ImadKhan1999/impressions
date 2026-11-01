import Database from 'better-sqlite3';
import { migrate } from './migrate.js';

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -32000'); // ~32 MB page cache
  migrate(db);
  return db;
}

export function closeDatabase(db: DB): void {
  if (!db.open) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }
  db.close();
}
