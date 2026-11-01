import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';
import { CookieJar } from 'tough-cookie';
import type { CookieInfo, DeviceProfile, ErrorCode, HopType, RedirectHop } from '@impressions/shared';
import { createAgent, type ResolvedProxy } from '../../proxies/agents.js';
import { classifyError, outcomeFor, type EngineResult, type EngineTask } from '../types.js';
import { findMetaRefresh, findTitle, hasViewportMeta, looksLikeJsRedirect } from './html-sniff.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BODY_SNIFF_LIMIT = 256 * 1024;
const RECORDED_HEADERS = [
  'server',
  'content-type',
  'content-length',
  'cache-control',
  'x-powered-by',
  'via',
  'x-cache',
  'cf-ray',
  'x-served-by',
  'strict-transport-security',
  'vary',
  'refresh',
];
/** Meta refreshes with longer delays are treated as page content, not redirects. */
const MAX_META_REFRESH_DELAY = 30;

interface HopResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  remoteAddress: string | null;
  ttfbMs: number;
  totalMs: number;
  body: string | null;
}

export function acceptLanguage(locale: string): string {
  const lang = locale.split('-')[0] ?? locale;
  return lang && lang !== locale ? `${locale},${lang};q=0.9` : locale;
}

export function navigationHeaders(profile: DeviceProfile | null, url: URL, isFirst: boolean): Record<string, string> {
  const h: Record<string, string> = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': acceptLanguage(profile?.locale ?? 'en-US'),
    'accept-encoding': 'gzip, deflate, br',
    'upgrade-insecure-requests': '1',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': isFirst ? 'none' : 'cross-site',
    'sec-fetch-user': '?1',
  };
  h['user-agent'] =
    profile?.userAgent ??
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
  // Chromium only sends client hints over secure connections.
  if (profile?.clientHints && url.protocol === 'https:') Object.assign(h, profile.clientHints);
  return h;
}

function decodeStream(res: http.IncomingMessage): Readable {
  const enc = String(res.headers['content-encoding'] ?? '').toLowerCase().trim();
  const opts = { finishFlush: zlib.constants.Z_SYNC_FLUSH };
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip(opts));
  if (enc === 'deflate') return res.pipe(zlib.createInflate(opts));
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress({ finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH }));
  return res;
}

/** Reads up to `limit` bytes of the (decoded) body, then stops. */
function readBodyPrefix(res: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve) => {
    const stream = decodeStream(res);
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      res.destroy();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    stream.on('data', (c: Buffer) => {
      chunks.push(c);
      size += c.length;
      if (size >= limit) finish();
    });
    stream.on('end', finish);
    stream.on('error', finish);
    res.on('aborted', finish);
    res.on('error', finish);
  });
}

function requestOnce(
  url: URL,
  method: 'GET' | 'HEAD',
  headers: Record<string, string>,
  proxy: ResolvedProxy | null,
  signal: AbortSignal,
  wantBody: (status: number, headers: http.IncomingHttpHeaders) => boolean,
): Promise<HopResponse> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const mod = url.protocol === 'https:' ? https : http;
    const agent = createAgent(proxy, url.protocol as 'http:' | 'https:');
    let remoteAddress: string | null = null;
    const req = mod.request(
      url,
      { method, headers, agent, signal },
      (res) => {
        const ttfbMs = Math.round(performance.now() - started);
        remoteAddress = remoteAddress ?? res.socket?.remoteAddress ?? null;
        const status = res.statusCode ?? 0;
        const finish = (body: string | null) => {
          agent.destroy();
          resolve({ status, headers: res.headers, remoteAddress, ttfbMs, totalMs: Math.round(performance.now() - started), body });
        };
        if (method !== 'HEAD' && wantBody(status, res.headers)) {
          void readBodyPrefix(res, BODY_SNIFF_LIMIT).then(finish);
        } else {
          res.resume();
          res.destroy();
          finish(null);
        }
      },
    );
    req.on('socket', (socket) => {
      socket.once('connect', () => {
        remoteAddress = socket.remoteAddress ?? null;
      });
    });
    req.on('error', (err) => {
      agent.destroy();
      reject(err);
    });
    req.end();
  });
}

function pickHeaders(h: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of RECORDED_HEADERS) {
    const v = h[k];
    if (v !== undefined) out[k] = Array.isArray(v) ? v.join(', ') : String(v).slice(0, 500);
  }
  const sc = h['set-cookie'];
  if (sc?.length) out['set-cookie'] = sc.map((c) => c.split('=')[0]?.trim()).filter(Boolean).join(', ');
  return out;
}

const isHtml = (h: http.IncomingHttpHeaders) => /html|xml/i.test(String(h['content-type'] ?? 'text/html'));

/**
 * Follows a redirect chain hop by hop with full control over each request,
 * recording status, location, timing and errors for every step.
 */
export class HttpRedirectEngine {
  async run(task: EngineTask): Promise<EngineResult> {
    const { settings, profile, proxy } = task;
    const started = performance.now();
    const timeout = AbortSignal.timeout(settings.timeoutMs);
    const signal = AbortSignal.any([task.signal, timeout]);
    const jar = new CookieJar();
    const hops: RedirectHop[] = [];
    const visits = new Map<string, number>();
    const warnings: string[] = [];
    const method = settings.http.method;

    let current: URL;
    try {
      current = new URL(task.url);
    } catch {
      return this.fail(started, hops, 'INVALID_REDIRECT', `Invalid URL: ${task.url}`, {});
    }
    let reachedBy: HopType = 'initial';
    let lastBody: string | null = null;
    let lastHeaders: http.IncomingHttpHeaders = {};
    let finalStatus: number | null = null;
    let firstByteMs: number | null = null;

    for (let seq = 0; ; seq++) {
      const key = current.href;
      const seen = (visits.get(key) ?? 0) + 1;
      visits.set(key, seen);
      // A URL visited 3 times means the chain will never terminate (allowing one cookie-check bounce).
      if (seen > 2) {
        return this.fail(started, hops, 'REDIRECT_LOOP', `Redirect loop detected at ${key}`, { warnings }, finalStatus);
      }
      if (seq > settings.maxRedirects) {
        return this.fail(
          started,
          hops,
          'TOO_MANY_REDIRECTS',
          `Exceeded the maximum of ${settings.maxRedirects} redirects`,
          { warnings },
          finalStatus,
        );
      }

      const headers = navigationHeaders(profile, current, seq === 0);
      const cookie = await jar.getCookieString(current.href).catch(() => '');
      if (cookie) headers.cookie = cookie;

      let res: HopResponse;
      try {
        res = await requestOnce(current, method, headers, proxy, signal, (status, h) => {
          return status >= 200 && status < 300 && isHtml(h);
        });
      } catch (err) {
        let { code, message } = classifyError(err);
        if (code === 'ABORTED' && timeout.aborted && !task.signal.aborted) {
          code = 'TIMEOUT';
          message = `Timed out after ${settings.timeoutMs} ms`;
        }
        // With a proxy configured, unclassified failures come from the proxy handshake.
        if (proxy && (code === 'UNKNOWN' || /proxy|socks/i.test(message))) code = 'PROXY_ERROR';
        hops.push({
          seq,
          url: current.href,
          statusCode: null,
          location: null,
          hopType: reachedBy,
          method,
          responseTimeMs: null,
          remoteAddress: null,
          headers: null,
          error: `${code}: ${message}`,
        });
        return this.fail(started, hops, code, message, { warnings, cookies: await cookieInfo(jar) }, finalStatus);
      }

      if (firstByteMs === null) firstByteMs = res.ttfbMs;
      finalStatus = res.status;
      lastHeaders = res.headers;
      lastBody = res.body;
      for (const sc of res.headers['set-cookie'] ?? []) {
        await jar.setCookie(sc, current.href, { ignoreError: true }).catch(() => undefined);
      }

      const location = res.headers.location;
      let next: URL | null = null;
      let nextType: HopType | null = null;
      let invalid: string | null = null;

      if (REDIRECT_STATUSES.has(res.status) && location) {
        try {
          next = new URL(location, current);
          nextType = 'http';
        } catch {
          invalid = `Invalid Location header: ${location}`;
        }
      } else if (res.status >= 200 && res.status < 300) {
        // `Refresh` response header behaves like a meta refresh.
        const refreshHeader = res.headers.refresh ? findMetaRefresh(`<meta http-equiv="refresh" content="${String(res.headers.refresh).replace(/"/g, '&quot;')}">`) : null;
        const meta = refreshHeader ?? (res.body && settings.http.followMetaRefresh ? findMetaRefresh(res.body) : null);
        if (meta?.url && settings.http.followMetaRefresh) {
          if (meta.delaySeconds <= MAX_META_REFRESH_DELAY) {
            try {
              next = new URL(meta.url, current);
              nextType = 'meta';
            } catch {
              invalid = `Invalid meta refresh URL: ${meta.url}`;
            }
          } else {
            warnings.push(`Meta refresh after ${meta.delaySeconds}s to ${meta.url} was not followed`);
          }
        }
      }

      hops.push({
        seq,
        url: current.href,
        statusCode: res.status,
        location: next?.href ?? (location ? String(location) : null),
        hopType: reachedBy,
        method,
        responseTimeMs: res.ttfbMs,
        remoteAddress: res.remoteAddress,
        headers: pickHeaders(res.headers),
        error: invalid,
      });

      if (invalid) return this.fail(started, hops, 'INVALID_REDIRECT', invalid, { warnings }, finalStatus);

      if (next && next.protocol !== 'http:' && next.protocol !== 'https:') {
        // App deep links (intent://, market://, itms-apps://): the chain ends at a non-web destination.
        warnings.push(`Redirects to non-web URL scheme "${next.protocol}" (${next.href.slice(0, 200)})`);
        return this.fail(
          started,
          hops,
          'INVALID_REDIRECT',
          `Redirect to unsupported scheme ${next.protocol}`,
          { warnings, cookies: await cookieInfo(jar) },
          finalStatus,
        );
      }

      if (next && nextType) {
        if (current.protocol === 'https:' && next.protocol === 'http:') warnings.push(`Downgrade from HTTPS to HTTP at hop ${seq + 1}`);
        current = next;
        reachedBy = nextType;
        continue;
      }
      if (REDIRECT_STATUSES.has(res.status) && !location) warnings.push(`HTTP ${res.status} without a Location header`);
      break;
    }

    const html = lastBody ?? '';
    const jsSuspected = html ? looksLikeJsRedirect(html) : false;
    if (jsSuspected) warnings.push('Page appears to redirect with JavaScript; use browser mode to follow it');
    const finalHop = hops[hops.length - 1]!;
    const viewportMeta = html ? hasViewportMeta(html) : null;
    return {
      status: outcomeFor(finalStatus, finalStatus !== null && finalStatus >= 400 ? 'HTTP_ERROR' : null),
      finalUrl: finalHop.url,
      finalStatus,
      redirectCount: hops.length - 1,
      totalTimeMs: Math.round(performance.now() - started),
      errorCode: finalStatus !== null && finalStatus >= 400 ? 'HTTP_ERROR' : null,
      errorMessage: finalStatus !== null && finalStatus >= 400 ? `Final response HTTP ${finalStatus}` : null,
      hops,
      details: {
        title: html ? findTitle(html) : null,
        contentType: lastHeaders['content-type'] ? String(lastHeaders['content-type']) : null,
        jsRedirectSuspected: jsSuspected,
        cookies: await cookieInfo(jar),
        layout: null,
        warnings,
        timings: { firstByteMs },
        ...(viewportMeta !== null ? { viewportMeta } : {}),
      },
    };
  }

  private fail(
    started: number,
    hops: RedirectHop[],
    code: ErrorCode,
    message: string,
    details: EngineResult['details'],
    finalStatus: number | null = null,
  ): EngineResult {
    const last = hops[hops.length - 1];
    return {
      status: 'error',
      finalUrl: last?.url ?? null,
      finalStatus,
      redirectCount: Math.max(0, hops.length - 1),
      totalTimeMs: Math.round(performance.now() - started),
      errorCode: code,
      errorMessage: message,
      hops,
      details,
    };
  }
}

async function cookieInfo(jar: CookieJar): Promise<CookieInfo[]> {
  try {
    const all = await jar.serialize();
    return (all.cookies ?? []).slice(0, 200).map((c) => ({
      name: String(c.key ?? ''),
      domain: String(c.domain ?? ''),
      path: String(c.path ?? '/'),
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      sameSite: c.sameSite ? String(c.sameSite) : null,
      expires: c.expires && c.expires !== 'Infinity' ? String(c.expires) : null,
    }));
  } catch {
    return [];
  }
}
