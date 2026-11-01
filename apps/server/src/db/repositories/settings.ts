import { appSettingsSchema, type AppSettings } from '@impressions/shared';
import type { DB } from '../connection.js';

const KEY = 'app';

export class SettingsRepository {
  private cache: AppSettings | null = null;

  constructor(private readonly db: DB) {}

  get(): AppSettings {
    if (this.cache) return this.cache;
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
    let parsed: AppSettings;
    try {
      parsed = appSettingsSchema.parse(row ? JSON.parse(row.value) : {});
    } catch {
      // Corrupt or outdated settings: fall back to defaults rather than failing startup.
      parsed = appSettingsSchema.parse({});
    }
    this.cache = parsed;
    return parsed;
  }

  set(next: AppSettings): AppSettings {
    const value = appSettingsSchema.parse(next);
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(KEY, JSON.stringify(value));
    this.cache = value;
    return value;
  }
}
