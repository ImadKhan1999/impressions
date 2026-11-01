import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportReport, Paginated, TestRun, TestTask, UrlList } from '@impressions/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createContext, type AppContext } from '../src/context.js';
import { startSite, type Fixture } from './fixtures/servers.js';

const silent = { info() {}, warn() {}, error() {} };
let dir: string;
let ctx: AppContext;
let app: FastifyInstance;
let site: Fixture;

async function waitFor<T>(fn: () => T | Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`waitFor timed out; last value ${JSON.stringify(v).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const json = <T>(res: { json: () => unknown }) => res.json() as T;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-api-'));
  const config = loadConfig({ dataDir: dir, dbPath: path.join(dir, 'test.db'), artifactsDir: path.join(dir, 'artifacts'), webDistDir: null });
  fs.mkdirSync(config.artifactsDir, { recursive: true });
  ctx = createContext(config, silent);
  ctx.profiles.seedBuiltins();
  app = await buildApp(ctx);
  site = await startSite();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  await site.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('profiles API', () => {
  it('pages and filters a large library', async () => {
    const res = json<Paginated<{ platform: string }>>(await app.inject('/api/profiles?platform=ios&pageSize=10'));
    expect(res.total).toBeGreaterThan(100);
    expect(res.items).toHaveLength(10);
    expect(res.items.every((p) => p.platform === 'ios')).toBe(true);
    const facets = json<{ total: number; platform: { value: string; count: number }[] }>(await app.inject('/api/profiles/facets'));
    expect(facets.total).toBeGreaterThan(1500);
    expect(facets.platform.map((p) => p.value).sort()).toEqual(['android', 'ios', 'linux', 'macos', 'windows']);
  });

  it('generates profiles from the catalog and skips duplicates', async () => {
    const body = { deviceIds: ['pixel-8', 'iphone-15'], browsers: ['chrome', 'firefox'], browserVersionsPerBrowser: 4 };
    const dry = json<{ generated: number; created: number }>(await app.inject({ method: 'POST', url: '/api/profiles/generate', payload: { ...body, dryRun: true } }));
    expect(dry.generated).toBeGreaterThan(8);
    expect(dry.created).toBe(0);
    const real = json<{ created: number; skipped: number }>(await app.inject({ method: 'POST', url: '/api/profiles/generate', payload: body }));
    expect(real.created + real.skipped).toBe(dry.generated);
    const again = json<{ created: number }>(await app.inject({ method: 'POST', url: '/api/profiles/generate', payload: body }));
    expect(again.created).toBe(0);
  });

  it('creates, updates and validates custom profiles', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: '' } });
    expect(bad.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(bad).error.code).toBe('VALIDATION_ERROR');
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: {
        name: 'Kiosk',
        platform: 'linux',
        formFactor: 'desktop',
        osVersion: 'Ubuntu 24.04',
        browser: 'chrome',
        browserVersion: '140',
        viewportWidth: 1080,
        viewportHeight: 1920,
        screenWidth: 1080,
        screenHeight: 1920,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const p = json<{ id: number; userAgent: string; engine: string }>(created);
    expect(p.userAgent).toContain('Chrome/140.0.0.0');
    expect(p.engine).toBe('chromium');
    const upd = json<{ userAgent: string }>(await app.inject({ method: 'PATCH', url: `/api/profiles/${p.id}`, payload: { browserVersion: '141' } }));
    expect(upd.userAgent).toContain('Chrome/141.0.0.0');
  });
});

describe('URL lists and import', () => {
  it('imports CSV with header, de-duplicates and reports rejects', async () => {
    const list = json<UrlList>(await app.inject({ method: 'POST', url: '/api/url-lists', payload: { name: 'CSV list' } }));
    const csv = '﻿url;label;tags\r\nexample.com;Home;a|b\r\nhttps://example.com/;Dup;\r\nftp://nope;Bad;\r\n"https://a.example.org/x?y=1";Quoted;c\r\n';
    const boundary = '----ictest';
    const payload =
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="urls.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/url-lists/${list.id}/import`,
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(200);
    const report = json<ImportReport>(res);
    expect(report.format).toBe('csv');
    expect(report.inserted).toBe(2);
    expect(report.duplicates).toBe(1);
    expect(report.rejected).toBe(1);
    expect(report.rejects[0]!.line).toBe(4);
    const urls = json<Paginated<{ url: string; label: string; tags: string[]; domain: string }>>(await app.inject(`/api/url-lists/${list.id}/urls`));
    expect(urls.items[0]).toMatchObject({ url: 'https://example.com/', label: 'Home', tags: ['a', 'b'], domain: 'example.com' });
    expect(urls.items[1]!.domain).toBe('example.org');
  });

  it('accepts thousands of pasted URLs quickly', async () => {
    const list = json<UrlList>(await app.inject({ method: 'POST', url: '/api/url-lists', payload: { name: 'Big list' } }));
    const text = Array.from({ length: 5000 }, (_, i) => `https://site${i % 250}.example.com/page/${i}`).join('\n');
    const t0 = Date.now();
    const report = json<ImportReport>(await app.inject({ method: 'POST', url: `/api/url-lists/${list.id}/urls`, payload: { text } }));
    expect(report.inserted).toBe(5000);
    expect(Date.now() - t0).toBeLessThan(5000);
    const l = json<UrlList>(await app.inject(`/api/url-lists/${list.id}`));
    expect(l.urlCount).toBe(5000);
    expect(l.domainCount).toBe(1); // all subdomains share the registrable domain example.com
  });
});

describe('runs', () => {
  let listId: number;
  beforeAll(async () => {
    const list = json<UrlList>(await app.inject({ method: 'POST', url: '/api/url-lists', payload: { name: 'Fixture site' } }));
    listId = list.id;
    const text = ['/chain', '/meta', '/not-found', '/cookie-check', '/device'].map((p) => site.url(p)).join('\n');
    await app.inject({ method: 'POST', url: `/api/url-lists/${listId}/urls`, payload: { text } });
  });

  it('runs an HTTP test end-to-end and records hops', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        name: 'HTTP run',
        mode: 'http',
        urlListId: listId,
        profiles: { filter: { q: 'Pixel 8 Chrome 142 Android 15', platform: ['android'] } },
        settings: { requestsPerSecondPerDomain: 5, maxConcurrentPerDomain: 4 },
      },
    });
    expect(created.statusCode).toBe(201);
    const run = json<TestRun>(created);
    expect(run.totalTasks).toBe(5 * run.profileCount);
    const done = await waitFor(
      async () => json<{ run: TestRun }>(await app.inject(`/api/runs/${run.id}`)).run,
      (r) => r.status === 'completed',
    );
    expect(done.doneTasks).toBe(done.totalTasks);
    const tasks = json<Paginated<TestTask>>(await app.inject(`/api/runs/${run.id}/tasks?pageSize=100`));
    const chain = tasks.items.find((t) => t.url.endsWith('/chain'))!;
    expect(chain.redirectCount).toBe(3);
    expect(chain.status).toBe('success');
    const device = tasks.items.find((t) => t.url.endsWith('/device'))!;
    expect(device.finalUrl).toContain('site=mobile');
    const nf = tasks.items.find((t) => t.url.endsWith('/not-found'))!;
    expect(nf.status).toBe('failed');
    const detail = json<{ hops: unknown[] }>(await app.inject(`/api/tasks/${chain.id}`));
    expect(detail.hops).toHaveLength(4);

    const summary = json<{ byStatus: Record<string, number> }>(await app.inject(`/api/runs/${run.id}/summary`));
    expect(summary.byStatus.failed).toBe(run.profileCount);

    const csv = await app.inject(`/api/runs/${run.id}/export?format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
    expect(csv.body.split('\r\n').length).toBeGreaterThan(run.totalTasks);
    const html = await app.inject(`/api/runs/${run.id}/export?format=html`);
    expect(html.body).toContain('<h1>HTTP run</h1>');
    const js = await app.inject(`/api/runs/${run.id}/export?format=json`);
    expect(JSON.parse(js.body).tasks).toHaveLength(run.totalTasks);
  });

  it('never tests the same url/profile/engine twice in a run', async () => {
    const run = json<TestRun>(
      await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { name: 'dupe check', mode: 'http', urlListId: listId, profiles: { ids: [1, 1, 2] }, start: false },
      }),
    );
    expect(run.totalTasks).toBe(5 * 2);
    expect(run.status).toBe('draft');
  });

  it('enforces per-domain rate limits even when the client asks for more', async () => {
    const before = site.hits.get('/final') ?? 0;
    const created = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        name: 'Rate limited',
        mode: 'http',
        urlListId: listId,
        profiles: { filter: { q: 'Galaxy S24 Chrome 142 Android 15', platform: ['android'] } },
        settings: { requestsPerSecondPerDomain: 100, concurrency: 64 },
      },
    });
    // Out-of-range limits are rejected outright rather than silently accepted.
    expect(created.statusCode).toBe(400);
    void before;

    const ok = json<TestRun>(
      await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: {
          name: 'Rate limited',
          mode: 'http',
          urlListId: listId,
          profiles: { ids: [1, 2] },
          settings: { requestsPerSecondPerDomain: 2, maxConcurrentPerDomain: 1, concurrency: 16 },
        },
      }),
    );
    const t0 = Date.now();
    await waitFor(async () => json<{ run: TestRun }>(await app.inject(`/api/runs/${ok.id}`)).run, (r) => r.status === 'completed');
    // 10 tasks on one domain at 2/s => at least ~4.5s
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4000);
  });

  it('pauses, resumes and cancels', async () => {
    const run = json<TestRun>(
      await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: {
          name: 'Lifecycle',
          mode: 'http',
          urlListId: listId,
          profiles: { ids: [1, 2, 3, 4] },
          settings: { requestsPerSecondPerDomain: 1, maxConcurrentPerDomain: 1 },
        },
      }),
    );
    await waitFor(async () => json<{ run: TestRun }>(await app.inject(`/api/runs/${run.id}`)).run, (r) => r.status === 'running');
    await app.inject({ method: 'POST', url: `/api/runs/${run.id}/pause` });
    const paused = await waitFor(async () => json<{ run: TestRun }>(await app.inject(`/api/runs/${run.id}`)).run, (r) => r.status === 'paused');
    expect(paused.doneTasks).toBeLessThan(paused.totalTasks);
    const resumed = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/resume` });
    expect(resumed.statusCode).toBe(200);
    await waitFor(async () => json<{ run: TestRun }>(await app.inject(`/api/runs/${run.id}`)).run, (r) => r.status === 'running');
    const cancelled = json<TestRun>(await app.inject({ method: 'POST', url: `/api/runs/${run.id}/cancel` }));
    expect(cancelled.status).toBe('cancelled');
    const tasks = json<Paginated<TestTask>>(await app.inject(`/api/runs/${run.id}/tasks?status=pending,running`));
    expect(tasks.total).toBe(0);
  });

  it('rejects cross-origin writes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/url-lists',
      payload: { name: 'evil' },
      headers: { origin: 'http://evil.example', host: '127.0.0.1:5310' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('proxies API', () => {
  it('never returns stored passwords', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxies',
      payload: { name: 'Office', protocol: 'socks5', host: '10.0.0.5', port: 1080, username: 'me', password: 'hunter2' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain('hunter2');
    const p = json<{ hasPassword: boolean }>(res);
    expect(p.hasPassword).toBe(true);
    const raw = ctx.db.prepare('SELECT password_enc FROM proxies').pluck().get() as string;
    expect(raw).not.toContain('hunter2');
  });
});
