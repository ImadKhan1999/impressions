export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toLocaleString());

export const fmtPct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '–' : `${(n * 100).toFixed(digits)}%`;

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return fmtDuration(ms / 1000);
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '–';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '–';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86_400 * 7) return `${Math.round(diff / 86_400)} d ago`;
  return fmtDate(iso);
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export function runDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return '–';
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  return fmtDuration((end - new Date(startedAt).getTime()) / 1000);
}

export const PLATFORM_LABEL: Record<string, string> = {
  android: 'Android',
  ios: 'iOS',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};
export const BROWSER_LABEL: Record<string, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
  samsung: 'Samsung Internet',
  opera: 'Opera',
};
export const FORM_LABEL: Record<string, string> = { mobile: 'Mobile', tablet: 'Tablet', desktop: 'Desktop' };
export const ENGINE_LABEL: Record<string, string> = { chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit' };
export const MODE_LABEL: Record<string, string> = { http: 'HTTP', browser: 'Browser', both: 'HTTP + Browser' };

export const shortUrl = (u: string | null | undefined, max = 80) => {
  if (!u) return '–';
  const s = u.replace(/^https?:\/\//, '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
