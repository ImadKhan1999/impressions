import http from 'node:http';
import https from 'node:https';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { BrowserEngineName, ProxyProtocol } from '@impressions/shared';

/** A proxy with its decrypted password, used only in-process for one run. */
export interface ResolvedProxy {
  id: number;
  name: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  remoteDns: boolean;
}

const hostPart = (host: string) => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host);

/** Builds the proxy URL understood by the agent libraries. */
export function proxyUrl(p: ResolvedProxy, opts: { includeAuth: boolean } = { includeAuth: true }): string {
  let scheme: string;
  switch (p.protocol) {
    case 'http':
      scheme = 'http';
      break;
    case 'https':
      scheme = 'https';
      break;
    case 'socks4':
      scheme = p.remoteDns ? 'socks4a' : 'socks4';
      break;
    case 'socks5':
      scheme = p.remoteDns ? 'socks5h' : 'socks5';
      break;
  }
  const auth =
    opts.includeAuth && p.username
      ? `${encodeURIComponent(p.username)}${p.password ? ':' + encodeURIComponent(p.password) : ''}@`
      : '';
  return `${scheme}://${auth}${hostPart(p.host)}:${p.port}`;
}

/** Redacted form for logs and error messages. */
export function describeProxy(p: ResolvedProxy): string {
  return `${p.protocol}://${p.username ? `${p.username}:***@` : ''}${hostPart(p.host)}:${p.port}`;
}

export interface AgentOptions {
  /** Verify TLS certificates of target sites. */
  rejectUnauthorized?: boolean;
}

/**
 * Returns a fresh, non-pooled agent for one request so every hop measures its
 * own connection time and no state leaks between tasks.
 */
export function createAgent(
  proxy: ResolvedProxy | null,
  targetProtocol: 'http:' | 'https:',
  opts: AgentOptions = {},
): http.Agent {
  const tls = { rejectUnauthorized: opts.rejectUnauthorized ?? true };
  if (!proxy) {
    return targetProtocol === 'https:' ? new https.Agent({ keepAlive: false, ...tls }) : new http.Agent({ keepAlive: false });
  }
  const url = proxyUrl(proxy);
  switch (proxy.protocol) {
    case 'http':
    case 'https':
      return targetProtocol === 'https:' ? new HttpsProxyAgent(url, { keepAlive: false, ...tls }) : new HttpProxyAgent(url, { keepAlive: false });
    case 'socks4':
    case 'socks5':
      return new SocksProxyAgent(url, { keepAlive: false, ...tls } as ConstructorParameters<typeof SocksProxyAgent>[1]);
  }
}

export type PlaywrightProxy = { server: string; username?: string; password?: string; bypass?: string };

/**
 * Converts a proxy to Playwright's launch option, or explains why the engine
 * cannot use it, so the problem is reported up front rather than as a timeout.
 */
export function playwrightProxy(
  proxy: ResolvedProxy,
  engine: BrowserEngineName,
): { ok: true; value: PlaywrightProxy } | { ok: false; reason: string } {
  const isSocks = proxy.protocol === 'socks4' || proxy.protocol === 'socks5';
  if (isSocks && proxy.username) {
    return {
      ok: false,
      reason: 'Browsers cannot authenticate to SOCKS proxies. Use an HTTP proxy, a SOCKS proxy without credentials, or HTTP engine mode.',
    };
  }
  if (proxy.protocol === 'socks4' && engine !== 'chromium') {
    return { ok: false, reason: `SOCKS4 proxies are only supported by the Chromium engine (profile uses ${engine}).` };
  }
  if (proxy.protocol === 'https' && engine !== 'chromium') {
    return { ok: false, reason: `HTTPS (TLS) proxies are only supported by the Chromium engine (profile uses ${engine}).` };
  }
  const server = `${proxy.protocol}://${hostPart(proxy.host)}:${proxy.port}`;
  return {
    ok: true,
    value: {
      server,
      ...(proxy.username ? { username: proxy.username, password: proxy.password ?? '' } : {}),
    },
  };
}
