import { z } from 'zod';
import {
  BROWSERS,
  ENGINES,
  ENGINE_STRATEGIES,
  FORM_FACTORS,
  LIMITS,
  PLATFORMS,
  PROFILE_SOURCES,
  PROXY_PROTOCOLS,
  RUN_MODES,
  RUN_STATUSES,
  TASK_ENGINES,
  TASK_STATUSES,
  WAIT_UNTIL,
} from './constants.js';

const bounded = (l: { min: number; max: number; default: number }) =>
  z.number().min(l.min).max(l.max);

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(50),
});

/** Query-string boolean: accepts true/false/1/0. */
export const queryBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

/** Comma separated list in a query string, or a repeated param. */
export const queryList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)));

/* ------------------------------------------------------------------ */
/* Device profiles                                                     */
/* ------------------------------------------------------------------ */

export const clientHintsSchema = z.record(z.string(), z.string());

export const profileInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  platform: z.enum(PLATFORMS),
  formFactor: z.enum(FORM_FACTORS),
  vendor: z.string().trim().max(100).nullable().optional(),
  model: z.string().trim().max(100).nullable().optional(),
  osVersion: z.string().trim().min(1).max(50),
  browser: z.enum(BROWSERS),
  browserVersion: z.string().trim().min(1).max(50),
  engine: z.enum(ENGINES).optional(),
  /** When omitted, the server builds the UA from the other fields. */
  userAgent: z.string().trim().min(10).max(1000).optional(),
  clientHints: clientHintsSchema.nullable().optional(),
  viewportWidth: z.number().int().min(200).max(7680),
  viewportHeight: z.number().int().min(200).max(4320),
  screenWidth: z.number().int().min(200).max(7680),
  screenHeight: z.number().int().min(200).max(4320),
  deviceScaleFactor: z.number().min(0.5).max(5),
  isMobile: z.boolean(),
  hasTouch: z.boolean(),
  locale: z.string().trim().min(2).max(20).default('en-US'),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  enabled: z.boolean().default(true),
});
export type ProfileInput = z.input<typeof profileInputSchema>;

export const profileUpdateSchema = profileInputSchema.partial();
export type ProfileUpdate = z.input<typeof profileUpdateSchema>;

export const profileQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  platform: queryList(PLATFORMS).optional(),
  formFactor: queryList(FORM_FACTORS).optional(),
  browser: queryList(BROWSERS).optional(),
  engine: queryList(ENGINES).optional(),
  source: queryList(PROFILE_SOURCES).optional(),
  enabled: queryBool.optional(),
  sort: z.enum(['name', 'platform', 'browser', 'updated']).default('name'),
});
export type ProfileQuery = z.output<typeof profileQuerySchema>;

/** Filter used to select profiles in bulk (bulk actions, run creation). */
export const profileFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  platform: z.array(z.enum(PLATFORMS)).optional(),
  formFactor: z.array(z.enum(FORM_FACTORS)).optional(),
  browser: z.array(z.enum(BROWSERS)).optional(),
  engine: z.array(z.enum(ENGINES)).optional(),
  source: z.array(z.enum(PROFILE_SOURCES)).optional(),
  enabled: z.boolean().optional(),
});
export type ProfileFilter = z.infer<typeof profileFilterSchema>;

/** Either an explicit id list or a filter ("select all matching"). */
export const profileSelectionSchema = z.union([
  z.object({ ids: z.array(z.number().int().positive()).min(1).max(LIMITS.maxProfiles) }),
  z.object({ filter: profileFilterSchema }),
]);
export type ProfileSelection = z.infer<typeof profileSelectionSchema>;

export const profileBulkSchema = z.object({
  selection: profileSelectionSchema,
  action: z.enum(['enable', 'disable', 'delete']),
});

export const profileGenerateSchema = z.object({
  deviceIds: z.array(z.string().min(1)).min(1).max(500),
  osVersions: z.array(z.string().min(1)).max(50).optional(),
  browsers: z.array(z.enum(BROWSERS)).min(1),
  browserVersionsPerBrowser: z.number().int().min(1).max(20).default(1),
  locale: z.string().trim().min(2).max(20).default('en-US'),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  dryRun: z.boolean().default(false),
});
export type ProfileGenerateInput = z.input<typeof profileGenerateSchema>;

export const profileImportSchema = z.object({
  profiles: z.array(profileInputSchema.extend({ slug: z.string().optional() })).min(1).max(LIMITS.maxProfiles),
  onConflict: z.enum(['skip', 'overwrite']).default('skip'),
});

export const userAgentPreviewSchema = z.object({
  platform: z.enum(PLATFORMS),
  formFactor: z.enum(FORM_FACTORS),
  model: z.string().trim().max(100).nullable().optional(),
  osVersion: z.string().trim().min(1).max(50),
  browser: z.enum(BROWSERS),
  browserVersion: z.string().trim().min(1).max(50),
});

/* ------------------------------------------------------------------ */
/* Proxies                                                             */
/* ------------------------------------------------------------------ */

const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.\-:[\]_]+$/, 'Host may only contain letters, digits, dots, dashes, colons and brackets');

export const proxyInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  protocol: z.enum(PROXY_PROTOCOLS),
  host: hostSchema,
  port: z.number().int().min(1).max(65535),
  username: z.string().max(200).nullable().optional(),
  /** Write-only. `undefined` keeps the stored password on update, `null` clears it. */
  password: z.string().max(500).nullable().optional(),
  remoteDns: z.boolean().default(true),
  notes: z.string().max(1000).nullable().optional(),
});
export type ProxyInput = z.input<typeof proxyInputSchema>;
export const proxyUpdateSchema = proxyInputSchema.partial();

export const proxyTestSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).default('https://example.com/'),
});

/* ------------------------------------------------------------------ */
/* URL lists                                                           */
/* ------------------------------------------------------------------ */

export const urlListInputSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(1000).nullable().optional(),
});
export const urlListUpdateSchema = urlListInputSchema.partial();

export const urlAddSchema = z.object({
  /** Raw text, one URL per line (same rules as TXT import). */
  text: z.string().max(5 * 1024 * 1024),
});

export const urlQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(500).optional(),
  domain: z.string().trim().max(253).optional(),
});

export const urlDeleteSchema = z.union([
  z.object({ ids: z.array(z.number().int().positive()).min(1).max(100_000) }),
  z.object({ all: z.literal(true) }),
]);

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export const runSettingsSchema = z.object({
  concurrency: bounded(LIMITS.concurrency).int().default(LIMITS.concurrency.default),
  browserConcurrency: bounded(LIMITS.browserConcurrency).int().default(LIMITS.browserConcurrency.default),
  requestsPerSecondPerDomain: bounded(LIMITS.requestsPerSecondPerDomain).default(
    LIMITS.requestsPerSecondPerDomain.default,
  ),
  maxConcurrentPerDomain: bounded(LIMITS.maxConcurrentPerDomain).int().default(LIMITS.maxConcurrentPerDomain.default),
  timeoutMs: bounded(LIMITS.timeoutMs).int().default(LIMITS.timeoutMs.default),
  maxRedirects: bounded(LIMITS.maxRedirects).int().default(LIMITS.maxRedirects.default),
  retries: bounded(LIMITS.retries).int().default(LIMITS.retries.default),
  browser: z
    .object({
      waitUntil: z.enum(WAIT_UNTIL).default('load'),
      settleMs: bounded(LIMITS.settleMs).int().default(LIMITS.settleMs.default),
      screenshot: z.boolean().default(false),
      captureCookieValues: z.boolean().default(false),
    })
    .prefault({}),
  http: z
    .object({
      followMetaRefresh: z.boolean().default(true),
      method: z.enum(['GET', 'HEAD']).default('GET'),
    })
    .prefault({}),
});
export type RunSettings = z.output<typeof runSettingsSchema>;
export type RunSettingsInput = z.input<typeof runSettingsSchema>;

export const runCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mode: z.enum(RUN_MODES),
  urlListId: z.number().int().positive(),
  /** One proxy for the whole run, or none. Proxies are never rotated. */
  proxyId: z.number().int().positive().nullable().default(null),
  profiles: profileSelectionSchema,
  settings: runSettingsSchema.prefault({}),
  start: z.boolean().default(true),
});
export type RunCreateInput = z.input<typeof runCreateSchema>;

export const runQuerySchema = pageQuerySchema.extend({
  status: queryList(RUN_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
});

export const taskQuerySchema = pageQuerySchema.extend({
  status: queryList(TASK_STATUSES).optional(),
  engine: queryList(TASK_ENGINES).optional(),
  profileId: z.coerce.number().int().positive().optional(),
  domain: z.string().trim().max(253).optional(),
  errorCode: z.string().trim().max(50).optional(),
  q: z.string().trim().max(500).optional(),
  sort: z.enum(['id', 'time', 'redirects', 'status']).default('id'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const exportQuerySchema = z.object({
  format: z.enum(['csv', 'json', 'html']).default('csv'),
});

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const appSettingsSchema = z.object({
  defaultRunSettings: runSettingsSchema.prefault({}),
  engineStrategy: z.enum(ENGINE_STRATEGIES).default('native'),
  maxConcurrentRuns: z.number().int().min(1).max(8).default(2),
  /** Global ceiling on simultaneously open browser contexts across all runs. */
  maxBrowserSessions: bounded(LIMITS.browserConcurrency).int().default(LIMITS.browserConcurrency.default),
  /** Close idle browser processes after this many seconds. */
  browserIdleSeconds: z.number().int().min(5).max(3600).default(60),
  headless: z.boolean().default(true),
  retentionDays: z.number().int().min(0).max(3650).default(0),
});
export type AppSettings = z.output<typeof appSettingsSchema>;
export const appSettingsUpdateSchema = appSettingsSchema.partial();
