import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContextOptions, Page, Request } from 'playwright';
import type {
  BrowserEngineName,
  CookieInfo,
  DeviceProfile,
  EngineStrategy,
  HopType,
  LayoutInfo,
  RedirectHop,
} from '@impressions/shared';
import { executionEngine } from '../../profiles/engine-map.js';
import { playwrightProxy, type PlaywrightProxy } from '../../proxies/agents.js';
import { acceptLanguage } from '../http/redirect-engine.js';
import { findMetaRefresh } from '../http/html-sniff.js';
import { classifyError, outcomeFor, type EngineResult, type EngineTask } from '../types.js';
import type { BrowserPool } from './browser-pool.js';

const DEFAULT_DESKTOP: Pick<DeviceProfile, 'viewportWidth' | 'viewportHeight' | 'screenWidth' | 'screenHeight'> = {
  viewportWidth: 1366,
  viewportHeight: 768,
  screenWidth: 1366,
  screenHeight: 768,
};

const RECORDED_HEADERS = ['server', 'content-type', 'cache-control', 'x-powered-by', 'via', 'cf-ray', 'x-cache'];

interface NavRecord {
  request: Request;
  startedAt: number;
  failure: string | null;
  /** Resolves to true when this navigation's document contains a meta refresh (or Refresh header). */
  hasMetaRefresh: Promise<boolean> | null;
}

export interface BrowserEngineOptions {
  pool: BrowserPool;
  artifactsDir: string;
  strategy: () => EngineStrategy;
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function contextOptionsFor(profile: DeviceProfile | null, engine: BrowserEngineName): BrowserContextOptions {
  const p = profile ?? null;
  const vp = p ?? DEFAULT_DESKTOP;
  const opts: BrowserContextOptions = {
    viewport: { width: vp.viewportWidth, height: vp.viewportHeight },
    screen: { width: vp.screenWidth, height: vp.screenHeight },
    deviceScaleFactor: p?.deviceScaleFactor ?? 1,
    hasTouch: p?.hasTouch ?? false,
    locale: p?.locale ?? 'en-US',
    acceptDownloads: false,
    serviceWorkers: 'block',
    ignoreHTTPSErrors: false,
    javaScriptEnabled: true,
    extraHTTPHeaders: { 'accept-language': acceptLanguage(p?.locale ?? 'en-US') },
  };
  if (p?.userAgent) opts.userAgent = p.userAgent;
  if (p?.timezone && isValidTimezone(p.timezone)) opts.timezoneId = p.timezone;
  // Firefox does not support the isMobile emulation flag.
  if (engine !== 'firefox') opts.isMobile = p?.isMobile ?? false;
  // Client hints are only meaningful for Chromium-based browser profiles.
  if (engine === 'chromium' && p?.clientHints) Object.assign(opts.extraHTTPHeaders!, p.clientHints);
  return opts;
}

/**
 * Real-browser engine. Opens the URL in an emulated device context, follows
 * HTTP, meta-refresh and JavaScript redirects, waits for the page to settle,
 * and records what the user would see. It only observes: it never clicks,
 * types, scrolls or otherwise interacts with page content.
 */
export class BrowserEngine {
  constructor(private readonly o: BrowserEngineOptions) {}

  async run(task: EngineTask): Promise<EngineResult> {
    const started = performance.now();
    const engine = executionEngine(task.profile?.engine ?? 'chromium', this.o.strategy());
    const warnings: string[] = [];
    if (task.profile && engine !== task.profile.engine) {
      warnings.push(`Profile engine ${task.profile.engine} emulated with ${engine} (engine strategy: chromium-only)`);
    }

    let proxyOpt: { id: number; value: PlaywrightProxy } | null = null;
    if (task.proxy) {
      const conv = playwrightProxy(task.proxy, engine);
      if (!conv.ok) return this.error(started, [], 'UNSUPPORTED', conv.reason, warnings);
      proxyOpt = { id: task.proxy.id, value: conv.value };
    }

    const timeout = AbortSignal.timeout(task.settings.timeoutMs + 5_000);
    const signal = AbortSignal.any([task.signal, timeout]);
    try {
      return await this.o.pool.withContext(engine, proxyOpt, contextOptionsFor(task.profile, engine), signal, async (ctx) => {
        const page = await ctx.newPage();
        return await this.observe(task, page, started, warnings);
      });
    } catch (err) {
      let { code, message } = classifyError(err);
      if (task.signal.aborted) code = 'ABORTED';
      else if (timeout.aborted) {
        code = 'TIMEOUT';
        message = `Timed out after ${task.settings.timeoutMs} ms`;
      }
      if (code === 'BROWSER_NOT_INSTALLED') {
        message = `The ${engine} browser is not installed. Run "npm run setup" (or "npx playwright install ${engine}").`;
      }
      return this.error(started, [], code, message, warnings);
    }
  }

  private async observe(task: EngineTask, page: Page, started: number, warnings: string[]): Promise<EngineResult> {
    const { settings } = task;
    const deadline = Date.now() + settings.timeoutMs;
    const remaining = () => Math.max(500, deadline - Date.now());
    const navs: NavRecord[] = [];
    const consoleErrors: string[] = [];
    let failedRequests = 0;
    let lastNavAt = Date.now();
    const main = page.mainFrame();

    page.on('request', (req) => {
      if (req.isNavigationRequest() && req.frame() === main) {
        navs.push({ request: req, startedAt: Date.now(), failure: null, hasMetaRefresh: null });
        lastNavAt = Date.now();
      }
    });
    page.on('requestfailed', (req) => {
      const rec = navs.find((n) => n.request === req);
      if (rec) rec.failure = req.failure()?.errorText ?? 'failed';
      else failedRequests++;
    });
    page.on('framenavigated', (f) => {
      if (f === main) lastNavAt = Date.now();
    });
    // Inspect each document response for a meta refresh so the next navigation can be labelled.
    page.on('response', (res) => {
      const rec = navs.find((n) => n.request === res.request());
      if (!rec || res.status() < 200 || res.status() >= 300) return;
      const refreshHeader = res.headers()['refresh'];
      rec.hasMetaRefresh = refreshHeader
        ? Promise.resolve(true)
        : res
            .text()
            .then((t) => findMetaRefresh(t.slice(0, 256 * 1024)) !== null)
            .catch(() => false);
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && consoleErrors.length < 20) consoleErrors.push(m.text().slice(0, 300));
    });
    page.on('pageerror', (e) => {
      if (consoleErrors.length < 20) consoleErrors.push(`Uncaught: ${e.message.slice(0, 280)}`);
    });
    // Passive handling so pages cannot block the test: dialogs are dismissed and popups closed.
    page.on('dialog', (d) => void d.dismiss().catch(() => undefined));
    page.on('popup', (p) => {
      warnings.push(`Page opened a popup to ${p.url().slice(0, 200)} (closed)`);
      void p.close().catch(() => undefined);
    });

    let gotoError: unknown = null;
    try {
      await page.goto(task.url, { waitUntil: settings.browser.waitUntil, timeout: remaining() });
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      if (/download is starting/i.test(msg)) warnings.push('Navigation triggered a file download');
      else if (/interrupted by another navigation|navigation.*aborted|ERR_ABORTED|NS_BINDING_ABORTED/i.test(msg)) {
        /* a client-side redirect replaced the navigation; keep observing */
      } else gotoError = err;
    }

    if (!gotoError) {
      // Settle: wait for network quiet, then for a quiet period without new navigations
      // so delayed JavaScript redirects are captured.
      await page.waitForLoadState('networkidle', { timeout: Math.min(remaining(), 10_000) }).catch(() => undefined);
      for (let i = 0; i <= settings.maxRedirects && Date.now() < deadline; i++) {
        const quietFor = Date.now() - lastNavAt;
        if (quietFor >= settings.browser.settleMs) break;
        await page.waitForTimeout(Math.min(settings.browser.settleMs - quietFor, remaining()));
        if (Date.now() - lastNavAt < settings.browser.settleMs) {
          await page.waitForLoadState('load', { timeout: Math.min(remaining(), 15_000) }).catch(() => undefined);
        }
      }
    }

    const hops = await this.buildHops(navs);
    const redirects = Math.max(0, hops.length - 1);
    if (redirects > settings.maxRedirects) warnings.push(`Chain exceeded ${settings.maxRedirects} redirects`);

    if (gotoError) {
      const { code, message } = classifyError(gotoError);
      const failedCode = Date.now() >= deadline && code === 'UNKNOWN' ? 'TIMEOUT' : code;
      return this.error(started, hops, failedCode, message.split('\n')[0] ?? message, warnings, { consoleErrors, failedRequests });
    }

    const lastWithResponse = [...hops].reverse().find((h) => h.statusCode !== null) ?? null;
    const finalStatus = lastWithResponse?.statusCode ?? null;
    const finalUrl = page.url();

    const [title, cookies, layout, timings] = await Promise.all([
      page.title().catch(() => null),
      this.cookies(page, settings.browser.captureCookieValues),
      this.layout(page, finalUrl),
      page
        .evaluate(() => {
          const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
          return n
            ? {
                firstByteMs: Math.round(n.responseStart),
                domContentLoadedMs: Math.round(n.domContentLoadedEventEnd),
                loadMs: Math.round(n.loadEventEnd) || null,
              }
            : null;
        })
        .catch(() => null),
    ]);

    let screenshot: string | null = null;
    if (settings.browser.screenshot) {
      try {
        const dir = path.join(this.o.artifactsDir, String(task.runId));
        await fs.promises.mkdir(dir, { recursive: true });
        const file = `${task.taskId}.jpg`;
        await page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 70, timeout: 10_000 });
        screenshot = `${task.runId}/${file}`;
      } catch (e) {
        warnings.push(`Screenshot failed: ${(e as Error).message.split('\n')[0]}`);
      }
    }

    if (layout?.horizontalOverflow) warnings.push(`Content is wider than the viewport (${layout.documentWidth}px > ${layout.viewportWidth}px)`);
    if (task.profile?.formFactor !== 'desktop' && layout && !layout.hasViewportMeta) warnings.push('No <meta name="viewport"> on a handheld profile');

    const errorCode = finalStatus !== null && finalStatus >= 400 ? 'HTTP_ERROR' : null;
    return {
      status: outcomeFor(finalStatus, errorCode),
      finalUrl,
      finalStatus,
      redirectCount: redirects,
      totalTimeMs: Math.round(performance.now() - started),
      errorCode: finalStatus === null ? 'UNKNOWN' : errorCode,
      errorMessage: finalStatus === null ? 'No document response was recorded' : errorCode ? `Final response HTTP ${finalStatus}` : null,
      hops,
      details: {
        title,
        contentType: lastWithResponse?.headers?.['content-type'] ?? null,
        cookies,
        layout,
        consoleErrors,
        failedRequests,
        screenshot,
        warnings,
        timings: timings ?? undefined,
        viewportMeta: layout?.viewportMeta ?? null,
      },
    };
  }

  private async buildHops(navs: NavRecord[]): Promise<RedirectHop[]> {
    const hops: RedirectHop[] = [];
    for (let i = 0; i < navs.length; i++) {
      const n = navs[i]!;
      const req = n.request;
      // Navigations cancelled by a newer one are noise, unless it is the last thing that happened.
      if (n.failure && /ABORTED|NS_BINDING_ABORTED|cancelled/i.test(n.failure) && i < navs.length - 1) continue;
      let hopType: HopType;
      if (hops.length === 0) hopType = 'initial';
      else if (req.redirectedFrom()) hopType = 'http';
      else {
        // Client-side navigation: meta refresh if the previous document declared one, otherwise script.
        const prev = navs.slice(0, i).reverse().find((x) => x.hasMetaRefresh !== null);
        hopType = prev && (await prev.hasMetaRefresh!) ? 'meta' : 'js';
      }

      const res = await req.response().catch(() => null);
      const timing = req.timing();
      const ttfb = timing.responseStart > 0 ? Math.round(timing.responseStart) : null;
      let headers: Record<string, string> | null = null;
      let remote: string | null = null;
      if (res) {
        const all = await res.allHeaders().catch(() => res.headers());
        headers = {};
        for (const k of RECORDED_HEADERS) if (all[k]) headers[k] = all[k]!.slice(0, 500);
        const sc = all['set-cookie'];
        if (sc) headers['set-cookie'] = sc.split('\n').map((c) => c.split('=')[0]?.trim()).filter(Boolean).join(', ');
        const addr = await res.serverAddr().catch(() => null);
        remote = addr ? addr.ipAddress : null;
      }
      const status = res?.status() ?? null;
      hops.push({
        seq: hops.length,
        url: req.url(),
        statusCode: status,
        location: res && status && status >= 300 && status < 400 ? ((await res.headerValue('location').catch(() => null)) ?? null) : null,
        hopType,
        method: req.method(),
        responseTimeMs: ttfb,
        remoteAddress: remote,
        headers,
        error: n.failure,
      });
    }
    // Resolve relative Location values against the hop URL; fill in from the next hop when missing.
    for (let i = 0; i < hops.length; i++) {
      const h = hops[i]!;
      if (h.location) {
        try {
          h.location = new URL(h.location, h.url).href;
        } catch {
          /* keep raw */
        }
      } else if (hops[i + 1] && h.statusCode && h.statusCode >= 300 && h.statusCode < 400) h.location = hops[i + 1]!.url;
    }
    return hops;
  }

  private async cookies(page: Page, withValues: boolean): Promise<CookieInfo[]> {
    try {
      const list = await page.context().cookies();
      return list.slice(0, 200).map((c) => ({
        name: c.name,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite ?? null,
        expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : null,
        ...(withValues ? { value: c.value.slice(0, 500) } : {}),
      }));
    } catch {
      return [];
    }
  }

  private async layout(page: Page, finalUrl: string): Promise<LayoutInfo | null> {
    try {
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const body = document.body;
        const meta = document.querySelector('meta[name="viewport" i]');
        // Sample visible text elements to estimate how much text is too small to read on a phone.
        const els = Array.from(document.querySelectorAll('p, li, a, span, td, div')).slice(0, 400);
        let textEls = 0;
        let small = 0;
        for (const el of els) {
          const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 2);
          if (!hasText) continue;
          textEls++;
          if (parseFloat(getComputedStyle(el).fontSize) < 12) small++;
        }
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentWidth: Math.max(de.scrollWidth, body ? body.scrollWidth : 0),
          documentHeight: Math.max(de.scrollHeight, body ? body.scrollHeight : 0),
          viewportMeta: meta ? meta.getAttribute('content') : null,
          smallTextRatio: textEls ? small / textEls : null,
        };
      });
      let host = '';
      try {
        host = new URL(finalUrl).hostname;
      } catch {
        /* ignore */
      }
      return {
        ...m,
        horizontalOverflow: m.documentWidth > m.viewportWidth + 1,
        hasViewportMeta: m.viewportMeta !== null,
        mobileHost: /^(m|mobile|touch|wap)\./i.test(host),
        smallTextRatio: m.smallTextRatio === null ? null : Math.round(m.smallTextRatio * 100) / 100,
      };
    } catch {
      return null;
    }
  }

  private error(
    started: number,
    hops: RedirectHop[],
    code: NonNullable<EngineResult['errorCode']>,
    message: string,
    warnings: string[],
    extra: { consoleErrors?: string[]; failedRequests?: number } = {},
  ): EngineResult {
    const last = hops[hops.length - 1];
    const lastStatus = [...hops].reverse().find((h) => h.statusCode !== null)?.statusCode ?? null;
    return {
      status: 'error',
      finalUrl: last?.url ?? null,
      finalStatus: lastStatus,
      redirectCount: Math.max(0, hops.length - 1),
      totalTimeMs: Math.round(performance.now() - started),
      errorCode: code,
      errorMessage: message,
      hops,
      details: { warnings, ...extra },
    };
  }
}
