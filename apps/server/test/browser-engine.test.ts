import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSettingsSchema, type DeviceProfile } from '@impressions/shared';
import { BrowserEngine } from '../src/engines/browser/browser-engine.js';
import { BrowserPool } from '../src/engines/browser/browser-pool.js';
import { findDevice } from '../src/profiles/catalog/devices.js';
import { profileFromParts } from '../src/profiles/generator.js';
import { startHttpProxy, startSite, type Fixture, type ProxyFixture } from './fixtures/servers.js';

const chromiumInstalled = BrowserPool.installed().find((b) => b.engine === 'chromium')?.installed;
const suite = chromiumInstalled ? describe : describe.skip;

const asProfile = (p: ReturnType<typeof profileFromParts>, id = 1): DeviceProfile => ({
  ...p,
  id,
  createdAt: '',
  updatedAt: '',
});

suite('BrowserEngine (Chromium)', () => {
  let site: Fixture;
  let pool: BrowserPool;
  let engine: BrowserEngine;
  let artifacts: string;
  const iphone = asProfile(profileFromParts(findDevice('pixel-8')!, '15', 'chrome', '142'));
  const desktop = asProfile(profileFromParts(findDevice('win-desktop-1080p')!, '11', 'chrome', '142'), 2);

  beforeAll(async () => {
    site = await startSite();
    artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-artifacts-'));
    pool = new BrowserPool({ headless: true, maxSessions: 2, idleMs: 5_000 });
    engine = new BrowserEngine({ pool, artifactsDir: artifacts, strategy: () => 'chromium-only' });
  });
  afterAll(async () => {
    await pool.shutdown();
    await site.close();
    fs.rmSync(artifacts, { recursive: true, force: true });
  });

  const run = (url: string, profile: DeviceProfile | null, over: Record<string, unknown> = {}, proxy: Parameters<BrowserEngine['run']>[0]['proxy'] = null) =>
    engine.run({
      taskId: Math.floor(Math.random() * 1e6),
      runId: 7,
      url,
      profile,
      proxy,
      settings: runSettingsSchema.parse({ timeoutMs: 20_000, browser: { settleMs: 1_200 }, ...over }),
      signal: new AbortController().signal,
    });

  it('records HTTP redirect hops in a real browser', async () => {
    const r = await run(site.url('/chain'), desktop);
    expect(r.status).toBe('success');
    expect(r.finalUrl).toBe(site.url('/final?from=chain'));
    expect(r.hops.map((h) => h.statusCode)).toEqual([301, 302, 307, 200]);
    expect(r.hops.slice(1).every((h) => h.hopType === 'http')).toBe(true);
    expect(r.details.title).toBe('Final page');
  });

  it('follows JavaScript redirects and classifies them', async () => {
    const r = await run(site.url('/js'), desktop);
    expect(r.finalUrl).toBe(site.url('/final?from=js'));
    expect(r.hops.at(-1)!.hopType).toBe('js');
  });

  it('waits for delayed JavaScript redirects during the settle period', async () => {
    const r = await run(site.url('/js-delayed'), desktop);
    expect(r.finalUrl).toBe(site.url('/final?from=js-delayed'));
  });

  it('follows meta refresh and labels it', async () => {
    const r = await run(site.url('/meta'), desktop);
    expect(r.finalUrl).toBe(site.url('/final?from=meta'));
    expect(r.hops.at(-1)!.hopType).toBe('meta');
  });

  it('emulates the device: UA-based mobile redirect, viewport and layout metrics', async () => {
    const m = await run(site.url('/device'), iphone);
    expect(m.finalUrl).toBe(site.url('/final?site=mobile'));
    expect(m.details.layout?.viewportWidth).toBe(iphone.viewportWidth);
    expect(m.details.layout?.hasViewportMeta).toBe(true);
    const d = await run(site.url('/device'), desktop);
    expect(d.finalUrl).toBe(site.url('/device'));
    const wide = await run(site.url('/wide'), iphone);
    expect(wide.details.layout?.horizontalOverflow).toBe(true);
    expect(wide.details.warnings?.some((w) => w.includes('wider than the viewport'))).toBe(true);
  });

  it('captures cookies set during the chain', async () => {
    const r = await run(site.url('/cookie-check'), desktop);
    expect(r.finalUrl).toBe(site.url('/final?from=cookie'));
    expect(r.details.cookies?.find((c) => c.name === 'seen')?.httpOnly).toBe(true);
    expect(r.details.cookies?.[0]?.value).toBeUndefined();
  });

  it('reports HTTP errors and network failures', async () => {
    const nf = await run(site.url('/not-found'), desktop);
    expect(nf.status).toBe('failed');
    expect(nf.finalStatus).toBe(404);
    const refused = await run('http://127.0.0.1:59999/', desktop);
    expect(refused.status).toBe('error');
    expect(refused.errorCode).toBe('CONNECTION_REFUSED');
  });

  it('reports redirects to app deep links as invalid instead of success', async () => {
    const r = await run(site.url('/deeplink'), desktop);
    expect(r.status).toBe('error');
    expect(r.errorCode).toBe('INVALID_REDIRECT');
    expect(r.finalUrl).not.toBe('about:blank');
    expect(r.details.warnings?.some((w: string) => /non-web URL scheme/.test(w))).toBe(true);
  });

  it('saves screenshots when enabled', async () => {
    const r = await run(site.url('/final'), iphone, { browser: { screenshot: true, settleMs: 200 } });
    expect(r.details.screenshot).toMatch(/^7\/\d+\.jpg$/);
    expect(fs.existsSync(path.join(artifacts, r.details.screenshot!))).toBe(true);
  });

  it('never opens more contexts than the session limit', async () => {
    let peak = 0;
    const timer = setInterval(() => (peak = Math.max(peak, pool.status.open)), 5);
    await Promise.all(Array.from({ length: 6 }, () => run(site.url('/final'), desktop, { browser: { settleMs: 100 } })));
    clearInterval(timer);
    expect(peak).toBeLessThanOrEqual(2);
    expect(pool.status.browsers.length).toBe(1);
  });

  describe('proxy', () => {
    let proxy: ProxyFixture;
    beforeAll(async () => {
      proxy = await startHttpProxy();
    });
    afterAll(async () => proxy.close());

    it('rejects SOCKS proxies with credentials up front', async () => {
      const r = await run(site.url('/final'), desktop, {}, {
        id: 9,
        name: 's',
        protocol: 'socks5',
        host: '127.0.0.1',
        port: 1080,
        username: 'u',
        password: 'p',
        remoteDns: true,
      });
      expect(r.errorCode).toBe('UNSUPPORTED');
    });

    it('routes browser traffic through a configured HTTP proxy', async () => {
      // Chromium bypasses the proxy for loopback, so target the site via a non-loopback alias.
      const r = await run(`http://ic-test.invalid:${site.port}/final`, desktop, {}, {
        id: 10,
        name: 'h',
        protocol: 'http',
        host: '127.0.0.1',
        port: proxy.port,
        username: null,
        password: null,
        remoteDns: true,
      });
      // The fixture proxy cannot resolve the alias, but the request must have reached it.
      expect(proxy.requests).toBeGreaterThan(0);
      expect(r.hops[0]?.url).toContain('ic-test.invalid');
    });
  });
});
