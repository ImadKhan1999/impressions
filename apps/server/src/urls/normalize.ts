import { getDomain, getHostname } from 'tldts';
import { LIMITS } from '@impressions/shared';

export type NormalizeResult = { ok: true; url: string; domain: string } | { ok: false; reason: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Normalises a user-supplied URL:
 * - trims whitespace and surrounding quotes/brackets
 * - adds https:// when no scheme is given
 * - lowercases scheme and host, removes default ports and fragments
 * - rejects non-http(s) schemes, credentials-only junk and invalid hosts
 */
export function normalizeUrl(raw: string): NormalizeResult {
  let s = raw.trim().replace(/^[<"'(]+|[>"')]+$/g, '').trim();
  if (!s) return { ok: false, reason: 'Empty value' };
  if (s.length > LIMITS.maxUrlLength) return { ok: false, reason: `URL longer than ${LIMITS.maxUrlLength} characters` };
  if (/\s/.test(s)) return { ok: false, reason: 'URL contains whitespace' };
  if (s.startsWith('//')) s = `https:${s}`;
  else if (!SCHEME.test(s) || /^[^:/]+:\d+(\/|$)/.test(s)) s = `https://${s}`;

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: 'Not a valid URL' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: `Unsupported scheme "${u.protocol.replace(':', '')}"` };
  const host = u.hostname;
  if (!host) return { ok: false, reason: 'Missing host' };
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
  if (!isIp && host !== 'localhost' && !host.includes('.')) return { ok: false, reason: `Invalid host "${host}"` };
  u.hash = '';
  return { ok: true, url: u.href, domain: domainKey(u.href) };
}

/**
 * The key used for per-domain rate limiting: the registrable domain
 * (example.co.uk for a.b.example.co.uk), or the host for IPs/localhost.
 */
export function domainKey(url: string): string {
  const host = getHostname(url) ?? '';
  return getDomain(url, { allowPrivateDomains: true }) ?? host.toLowerCase();
}
