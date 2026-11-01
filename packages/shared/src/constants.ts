/**
 * Shared enums, limits and defaults. These values are used by both the server
 * (authoritative enforcement) and the UI (form limits and hints).
 */

export const PLATFORMS = ['android', 'ios', 'windows', 'macos', 'linux'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const FORM_FACTORS = ['mobile', 'tablet', 'desktop'] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

export const BROWSERS = ['chrome', 'edge', 'firefox', 'safari', 'samsung', 'opera'] as const;
export type BrowserFamily = (typeof BROWSERS)[number];

export const ENGINES = ['chromium', 'firefox', 'webkit'] as const;
export type BrowserEngineName = (typeof ENGINES)[number];

export const PROFILE_SOURCES = ['builtin', 'generated', 'custom', 'imported'] as const;
export type ProfileSource = (typeof PROFILE_SOURCES)[number];

export const PROXY_PROTOCOLS = ['http', 'https', 'socks4', 'socks5'] as const;
export type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number];

export const RUN_MODES = ['http', 'browser', 'both'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const RUN_STATUSES = [
  'draft',
  'queued',
  'running',
  'paused',
  'completed',
  'cancelled',
  'failed',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running'];
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['completed', 'cancelled', 'failed'];

export const TASK_ENGINES = ['http', 'browser'] as const;
export type TaskEngine = (typeof TASK_ENGINES)[number];

export const TASK_STATUSES = ['pending', 'running', 'success', 'failed', 'error', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const HOP_TYPES = ['initial', 'http', 'meta', 'js', 'final'] as const;
export type HopType = (typeof HOP_TYPES)[number];

export const WAIT_UNTIL = ['commit', 'domcontentloaded', 'load', 'networkidle'] as const;
export type WaitUntil = (typeof WAIT_UNTIL)[number];

export const ENGINE_STRATEGIES = ['native', 'chromium-only'] as const;
export type EngineStrategy = (typeof ENGINE_STRATEGIES)[number];

/** Stable error taxonomy produced by both engines. */
export const ERROR_CODES = [
  'DNS_FAILURE',
  'CONNECTION_REFUSED',
  'CONNECTION_RESET',
  'TIMEOUT',
  'TLS_ERROR',
  'PROXY_ERROR',
  'TOO_MANY_REDIRECTS',
  'REDIRECT_LOOP',
  'INVALID_REDIRECT',
  'HTTP_ERROR',
  'BROWSER_ERROR',
  'BROWSER_NOT_INSTALLED',
  'UNSUPPORTED',
  'ABORTED',
  'UNKNOWN',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Transport-level errors that may be retried. Successful responses are never retried. */
export const RETRYABLE_ERROR_CODES: readonly ErrorCode[] = [
  'CONNECTION_RESET',
  'TIMEOUT',
  'PROXY_ERROR',
  'BROWSER_ERROR',
];

/**
 * Hard limits. The server clamps every run to these regardless of what the
 * client sends, so per-domain rate limiting cannot be turned off.
 */
export const LIMITS = {
  concurrency: { min: 1, max: 64, default: 8 },
  browserConcurrency: { min: 1, max: 32, default: 4 },
  requestsPerSecondPerDomain: { min: 0.1, max: 5, default: 1 },
  maxConcurrentPerDomain: { min: 1, max: 4, default: 2 },
  timeoutMs: { min: 2_000, max: 180_000, default: 30_000 },
  maxRedirects: { min: 0, max: 50, default: 20 },
  retries: { min: 0, max: 3, default: 1 },
  settleMs: { min: 0, max: 15_000, default: 2_500 },
  maxTasksPerRun: 1_000_000,
  maxProfilesPerRun: 10_000,
  maxProfiles: 25_000,
  maxImportBytes: 50 * 1024 * 1024,
  maxUrlLength: 8_192,
  pageSizeMax: 500,
} as const;

export const DEFAULT_PORT = 5310;
