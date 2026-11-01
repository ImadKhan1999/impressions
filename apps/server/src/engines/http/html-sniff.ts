/** Lightweight HTML inspection on the first part of a response body. */

const META_REFRESH =
  /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/i;
const CONTENT_ATTR = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

export interface MetaRefresh {
  delaySeconds: number;
  url: string | null;
}

/** Parses `<meta http-equiv="refresh" content="5; url=/next">`. */
export function findMetaRefresh(html: string): MetaRefresh | null {
  // Ignore refresh tags inside <noscript>, which browsers with JS enabled skip.
  const cleaned = html.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const tag = META_REFRESH.exec(cleaned)?.[0];
  if (!tag) return null;
  const m = CONTENT_ATTR.exec(tag);
  const content = decodeEntities((m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim());
  const parsed = /^\s*(\d+(?:\.\d+)?)?\s*(?:[;,]\s*(?:url\s*=\s*)?(.*))?$/i.exec(content);
  if (!parsed) return null;
  const delaySeconds = parsed[1] ? Number.parseFloat(parsed[1]) : 0;
  let url = parsed[2]?.trim() ?? '';
  url = url.replace(/^['"]|['"]$/g, '').trim();
  return { delaySeconds, url: url || null };
}

const JS_REDIRECT_PATTERNS = [
  /\b(?:window|document|top|self|parent)?\.?location(?:\.href)?\s*=\s*["'`]/i,
  /\blocation\.(?:replace|assign)\s*\(/i,
  /\bwindow\.open\s*\(\s*["'`][^"'`]+["'`]\s*,\s*["'`]_self/i,
  /\bnavigate(?:To)?\s*\(\s*["'`]https?:/i,
];

/** Heuristic: does inline script look like it performs a client-side redirect? */
export function looksLikeJsRedirect(html: string): boolean {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi);
  if (!scripts) return false;
  return scripts.some((s) => JS_REDIRECT_PATTERNS.some((re) => re.test(s)));
}

export function findTitle(html: string): string | null {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m?.[1]) return null;
  const t = decodeEntities(m[1].replace(/\s+/g, ' ').trim());
  return t ? t.slice(0, 300) : null;
}

export function hasViewportMeta(html: string): string | null {
  const m = /<meta\b[^>]*name\s*=\s*["']?viewport["']?[^>]*>/i.exec(html);
  if (!m) return null;
  const c = CONTENT_ATTR.exec(m[0]);
  return (c?.[1] ?? c?.[2] ?? c?.[3] ?? '').trim() || '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)));
}
