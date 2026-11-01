import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSettingsSchema, type DeviceProfile } from '@impressions/shared';
import { HttpRedirectEngine } from '../src/engines/http/redirect-engine.js';
import type { ResolvedProxy } from '../src/proxies/agents.js';
import { startHttpProxy, startSite, startSocks5, type Fixture, type ProxyFixture } from './fixtures/servers.js';

let site: Fixture;
const engine = new HttpRedirectEngine();
const settings = (over: Record<string, unknown> = {}) => runSettingsSchema.parse({ timeoutMs: 10_000, ...over });
const run = (url: string, opts: { proxy?: ResolvedProxy; profile?: Partial<DeviceProfile>; settings?: Record<string, unknown> } = {}) =>
  engine.run({
    taskId: 1,
    runId: 1,
    url,
    profile: (opts.profile as DeviceProfile) ?? null,
    proxy: opts.proxy ?? null,
    settings: settings(opts.settings),
    signal: new AbortController().signal,
  });

beforeAll(async () => {
  site = await startSite();
});
afterAll(async () => {
  await site.close();
});

describe('HttpRedirectEngine', () => {
  it('records every hop of a multi-status redirect chain', async () => {
    const r = await run(site.url('/chain'));
    expect(r.status).toBe('success');
    expect(r.hops.map((h) => h.statusCode)).toEqual([301, 302, 307, 200]);
    expect(r.hops.map((h) => h.hopType)).toEqual(['initial', 'http', 'http', 'http']);
    expect(r.redirectCount).toBe(3);
    expect(r.finalUrl).toBe(site.url('/final?from=chain'));
    expect(r.details.title).toBe('Final page');
    expect(r.hops[0]!.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(r.hops[0]!.location).toBe(site.url('/chain/2'));
  });

  it('follows meta refresh redirects', async () => {
    const r = await run(site.url('/meta'));
    expect(r.finalUrl).toBe(site.url('/final?from=meta'));
    expect(r.hops[1]!.hopType).toBe('meta');
  });

  it('flags JavaScript redirects it cannot follow', async () => {
    const r = await run(site.url('/js'));
    expect(r.status).toBe('success');
    expect(r.details.jsRedirectSuspected).toBe(true);
    expect(r.finalUrl).toBe(site.url('/js'));
  });

  it('detects redirect loops', async () => {
    const r = await run(site.url('/loop/a'));
    expect(r.status).toBe('error');
    expect(r.errorCode).toBe('REDIRECT_LOOP');
  });

  it('enforces the redirect limit', async () => {
    const r = await run(site.url('/endless'), { settings: { maxRedirects: 5 } });
    expect(r.errorCode).toBe('TOO_MANY_REDIRECTS');
    expect(r.hops).toHaveLength(6);
  });

  it('keeps cookies across hops like a browser', async () => {
    const r = await run(site.url('/cookie-check'));
    expect(r.finalUrl).toBe(site.url('/final?from=cookie'));
    expect(r.details.cookies?.map((c) => c.name)).toContain('seen');
    expect(r.hops[0]!.headers?.['set-cookie']).toBe('seen');
  });

  it('marks 4xx/5xx final responses as failed', async () => {
    const r = await run(site.url('/not-found'));
    expect(r.status).toBe('failed');
    expect(r.finalStatus).toBe(404);
    expect(r.errorCode).toBe('HTTP_ERROR');
  });

  it('decodes compressed bodies', async () => {
    const r = await run(site.url('/gzip'));
    expect(r.details.title).toBe('Compressed');
  });

  it('times out slow responses', async () => {
    const r = await run(site.url('/slow'), { settings: { timeoutMs: 2_000 } });
    expect(r.errorCode).toBe('TIMEOUT');
  });

  it('reports connection failures', async () => {
    const r = await run('http://127.0.0.1:1/');
    expect(r.errorCode).toBe('CONNECTION_REFUSED');
  });

  it('stops at app deep links', async () => {
    const r = await run(site.url('/deeplink'));
    expect(r.errorCode).toBe('INVALID_REDIRECT');
    expect(r.details.warnings?.[0]).toMatch(/market:/);
  });

  it('sends the device profile user agent for server-side device detection', async () => {
    const r = await run(site.url('/device'), {
      profile: { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) Mobile Safari/537.36', locale: 'de-DE', clientHints: null },
    });
    expect(r.finalUrl).toBe(site.url('/final?site=mobile'));
  });

  describe('proxies', () => {
    let httpProxy: ProxyFixture;
    let authProxy: ProxyFixture;
    let socks: ProxyFixture;
    let socksAuth: ProxyFixture;
    beforeAll(async () => {
      httpProxy = await startHttpProxy();
      authProxy = await startHttpProxy({ user: 'u', pass: 'p@ss' });
      socks = await startSocks5();
      socksAuth = await startSocks5({ user: 'u', pass: 'secret' });
    });
    afterAll(async () => {
      await Promise.all([httpProxy.close(), authProxy.close(), socks.close(), socksAuth.close()]);
    });
    const proxy = (p: Partial<ResolvedProxy>): ResolvedProxy => ({
      id: 1,
      name: 't',
      protocol: 'http',
      host: '127.0.0.1',
      port: 0,
      username: null,
      password: null,
      remoteDns: false,
      ...p,
    });

    it('routes through an HTTP proxy', async () => {
      const before = httpProxy.requests;
      const r = await run(site.url('/chain'), { proxy: proxy({ port: httpProxy.port }) });
      expect(r.status).toBe('success');
      expect(httpProxy.requests - before).toBe(4);
    });

    it('authenticates to an HTTP proxy', async () => {
      const ok = await run(site.url('/final'), { proxy: proxy({ port: authProxy.port, username: 'u', password: 'p@ss' }) });
      expect(ok.status).toBe('success');
      const bad = await run(site.url('/final'), { proxy: proxy({ port: authProxy.port, username: 'u', password: 'wrong' }) });
      expect(bad.finalStatus).toBe(407);
    });

    it('routes through SOCKS5 with and without auth', async () => {
      const r = await run(site.url('/chain'), { proxy: proxy({ protocol: 'socks5', port: socks.port }) });
      expect(r.status).toBe('success');
      expect(socks.requests).toBeGreaterThanOrEqual(4);
      const a = await run(site.url('/final'), {
        proxy: proxy({ protocol: 'socks5', port: socksAuth.port, username: 'u', password: 'secret' }),
      });
      expect(a.status).toBe('success');
      const bad = await run(site.url('/final'), {
        proxy: proxy({ protocol: 'socks5', port: socksAuth.port, username: 'u', password: 'nope' }),
      });
      expect(bad.status).toBe('error');
    });

    it('reports an unreachable proxy as a proxy/connection error', async () => {
      const r = await run(site.url('/final'), { proxy: proxy({ protocol: 'socks5', port: 1 }) });
      expect(r.status).toBe('error');
      expect(['PROXY_ERROR', 'CONNECTION_REFUSED']).toContain(r.errorCode);
    });
  });
});
