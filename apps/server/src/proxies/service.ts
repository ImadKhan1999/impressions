import {
  proxyInputSchema,
  proxyUpdateSchema,
  runSettingsSchema,
  type Proxy,
  type ProxyInput,
  type ProxyTestResult,
} from '@impressions/shared';
import type { ProxyRepository, ProxyWrite, StoredProxy } from '../db/repositories/proxies.js';
import { toPublicProxy } from '../db/repositories/proxies.js';
import type { EventBus } from '../events/bus.js';
import { HttpRedirectEngine } from '../engines/http/redirect-engine.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import type { ResolvedProxy } from './agents.js';
import type { SecretBox } from './crypto.js';

export class ProxyService {
  constructor(
    private readonly repo: ProxyRepository,
    private readonly secrets: SecretBox,
    private readonly bus: EventBus,
    private readonly isInUse: (proxyId: number) => boolean,
  ) {}

  list(): Proxy[] {
    return this.repo.list().map(toPublicProxy);
  }

  get(id: number): Proxy {
    return toPublicProxy(this.getStored(id));
  }

  private getStored(id: number): StoredProxy {
    const p = this.repo.get(id);
    if (!p) throw notFound('Proxy', id);
    return p;
  }

  create(raw: ProxyInput): Proxy {
    const input = proxyInputSchema.parse(raw);
    const write: ProxyWrite = {
      name: input.name,
      protocol: input.protocol,
      host: input.host,
      port: input.port,
      username: input.username || null,
      passwordEnc: input.password ? this.secrets.encrypt(input.password) : null,
      remoteDns: input.remoteDns,
      notes: input.notes ?? null,
    };
    try {
      const p = this.repo.insert(write);
      this.bus.emit({ type: 'proxies.changed' });
      return toPublicProxy(p);
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) throw conflict(`A proxy named "${input.name}" already exists`);
      throw e;
    }
  }

  update(id: number, raw: Partial<ProxyInput>): Proxy {
    const patch = proxyUpdateSchema.parse(raw);
    const cur = this.getStored(id);
    if (this.isInUse(id)) throw new AppError('PROXY_IN_USE', 'This proxy is used by an active run. Pause or finish the run first.', 409);
    const write: ProxyWrite = {
      name: patch.name ?? cur.name,
      protocol: patch.protocol ?? cur.protocol,
      host: patch.host ?? cur.host,
      port: patch.port ?? cur.port,
      username: patch.username !== undefined ? patch.username || null : cur.username,
      passwordEnc:
        patch.password === undefined ? cur.passwordEnc : patch.password ? this.secrets.encrypt(patch.password) : null,
      remoteDns: patch.remoteDns ?? cur.remoteDns,
      notes: patch.notes !== undefined ? patch.notes : cur.notes,
    };
    try {
      const p = this.repo.update(id, write);
      if (!p) throw notFound('Proxy', id);
      this.bus.emit({ type: 'proxies.changed' });
      return toPublicProxy(p);
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) throw conflict(`A proxy named "${write.name}" already exists`);
      throw e;
    }
  }

  delete(id: number): void {
    if (this.isInUse(id)) throw new AppError('PROXY_IN_USE', 'This proxy is used by an active run.', 409);
    if (!this.repo.delete(id)) throw notFound('Proxy', id);
    this.bus.emit({ type: 'proxies.changed' });
  }

  /** Returns the proxy with its decrypted password for in-process use only. */
  resolve(id: number): ResolvedProxy {
    const p = this.getStored(id);
    let password: string | null = null;
    if (p.passwordEnc) {
      try {
        password = this.secrets.decrypt(p.passwordEnc);
      } catch {
        throw new AppError('PROXY_SECRET', `Stored password for proxy "${p.name}" cannot be decrypted. Re-enter it.`, 409);
      }
    }
    return {
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      host: p.host,
      port: p.port,
      username: p.username,
      password,
      remoteDns: p.remoteDns,
    };
  }

  /** One request through the proxy to verify connectivity. */
  async test(id: number, url: string): Promise<ProxyTestResult> {
    const proxy = this.resolve(id);
    const engine = new HttpRedirectEngine();
    const settings = runSettingsSchema.parse({ timeoutMs: 15_000, maxRedirects: 5 });
    const res = await engine.run({
      taskId: 0,
      runId: 0,
      url,
      profile: null,
      proxy,
      settings,
      signal: new AbortController().signal,
    });
    const first = res.hops[0];
    const reached = res.hops.some((h) => h.statusCode !== null);
    const ok = reached && (res.errorCode === null || res.errorCode === 'HTTP_ERROR' || res.errorCode === 'TOO_MANY_REDIRECTS');
    const result: ProxyTestResult = {
      ok,
      latencyMs: first?.responseTimeMs ?? null,
      statusCode: res.finalStatus,
      remoteAddress: first?.remoteAddress ?? null,
      error: ok ? null : res.errorMessage,
      errorCode: ok ? null : res.errorCode,
    };
    this.repo.recordCheck(id, ok, result.latencyMs, result.error);
    this.bus.emit({ type: 'proxies.changed' });
    return result;
  }

  count(): number {
    return this.repo.count();
  }
}
