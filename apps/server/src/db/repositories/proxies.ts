import type { Proxy, ProxyProtocol } from '@impressions/shared';
import type { DB } from '../connection.js';
import { nowIso } from '../../lib/async.js';

interface ProxyRow {
  id: number;
  name: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  password_enc: string | null;
  remote_dns: number;
  notes: string | null;
  last_checked_at: string | null;
  last_check_ok: number | null;
  last_check_latency_ms: number | null;
  last_check_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Internal representation including the encrypted password. Never sent to clients. */
export interface StoredProxy extends Proxy {
  passwordEnc: string | null;
}

function rowTo(r: ProxyRow): StoredProxy {
  return {
    id: r.id,
    name: r.name,
    protocol: r.protocol,
    host: r.host,
    port: r.port,
    username: r.username,
    hasPassword: !!r.password_enc,
    passwordEnc: r.password_enc,
    remoteDns: !!r.remote_dns,
    notes: r.notes,
    lastCheckedAt: r.last_checked_at,
    lastCheckOk: r.last_check_ok === null ? null : !!r.last_check_ok,
    lastCheckLatencyMs: r.last_check_latency_ms,
    lastCheckError: r.last_check_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toPublicProxy(p: StoredProxy): Proxy {
  const { passwordEnc: _omit, ...pub } = p;
  return pub;
}

export interface ProxyWrite {
  name: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  passwordEnc: string | null;
  remoteDns: boolean;
  notes: string | null;
}

export class ProxyRepository {
  constructor(private readonly db: DB) {}

  list(): StoredProxy[] {
    return (this.db.prepare('SELECT * FROM proxies ORDER BY name COLLATE NOCASE').all() as ProxyRow[]).map(rowTo);
  }

  get(id: number): StoredProxy | null {
    const r = this.db.prepare('SELECT * FROM proxies WHERE id = ?').get(id) as ProxyRow | undefined;
    return r ? rowTo(r) : null;
  }

  insert(p: ProxyWrite): StoredProxy {
    const now = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO proxies (name, protocol, host, port, username, password_enc, remote_dns, notes, created_at, updated_at)
         VALUES (@name, @protocol, @host, @port, @username, @passwordEnc, @remoteDns, @notes, @now, @now)`,
      )
      .run({ ...p, remoteDns: p.remoteDns ? 1 : 0, now });
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, p: ProxyWrite): StoredProxy | null {
    const info = this.db
      .prepare(
        `UPDATE proxies SET name=@name, protocol=@protocol, host=@host, port=@port, username=@username,
           password_enc=@passwordEnc, remote_dns=@remoteDns, notes=@notes, updated_at=@now WHERE id=@id`,
      )
      .run({ ...p, remoteDns: p.remoteDns ? 1 : 0, now: nowIso(), id });
    return info.changes ? this.get(id) : null;
  }

  recordCheck(id: number, ok: boolean, latencyMs: number | null, error: string | null): void {
    this.db
      .prepare(
        `UPDATE proxies SET last_checked_at=?, last_check_ok=?, last_check_latency_ms=?, last_check_error=? WHERE id=?`,
      )
      .run(nowIso(), ok ? 1 : 0, latencyMs, error, id);
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM proxies WHERE id = ?').run(id).changes > 0;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM proxies').get() as { c: number }).c;
  }
}
