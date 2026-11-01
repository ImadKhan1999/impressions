import type {
  BrowserEngineName,
  BrowserFamily,
  ErrorCode,
  FormFactor,
  HopType,
  Platform,
  ProfileSource,
  ProxyProtocol,
  RunMode,
  RunStatus,
  TaskEngine,
  TaskStatus,
} from './constants.js';
import type { AppSettings, RunSettings } from './schemas.js';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface DeviceProfile {
  id: number;
  slug: string;
  name: string;
  platform: Platform;
  formFactor: FormFactor;
  vendor: string | null;
  model: string | null;
  osVersion: string;
  browser: BrowserFamily;
  browserVersion: string;
  engine: BrowserEngineName;
  userAgent: string;
  clientHints: Record<string, string> | null;
  viewportWidth: number;
  viewportHeight: number;
  screenWidth: number;
  screenHeight: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  locale: string;
  timezone: string;
  tags: string[];
  source: ProfileSource;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FacetCount<T extends string = string> {
  value: T;
  count: number;
}

export interface ProfileFacets {
  total: number;
  enabled: number;
  platform: FacetCount<Platform>[];
  formFactor: FacetCount<FormFactor>[];
  browser: FacetCount<BrowserFamily>[];
  engine: FacetCount<BrowserEngineName>[];
  source: FacetCount<ProfileSource>[];
}

export interface CatalogDevice {
  id: string;
  vendor: string;
  model: string;
  platform: Platform;
  formFactor: FormFactor;
  viewportWidth: number;
  viewportHeight: number;
  screenWidth: number;
  screenHeight: number;
  deviceScaleFactor: number;
  osVersions: string[];
  browsers: BrowserFamily[];
}

export interface CatalogBrowser {
  id: BrowserFamily;
  name: string;
  versions: string[];
  platforms: Platform[];
}

export interface ProfileCatalog {
  devices: CatalogDevice[];
  browsers: CatalogBrowser[];
}

export interface GenerateResult {
  generated: number;
  created: number;
  skipped: number;
  preview: Pick<DeviceProfile, 'name' | 'userAgent' | 'platform' | 'browser' | 'browserVersion' | 'osVersion'>[];
}

export interface Proxy {
  id: number;
  name: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  hasPassword: boolean;
  remoteDns: boolean;
  notes: string | null;
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckLatencyMs: number | null;
  lastCheckError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyTestResult {
  ok: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  remoteAddress: string | null;
  error: string | null;
  errorCode: ErrorCode | null;
}

export interface UrlList {
  id: number;
  name: string;
  description: string | null;
  urlCount: number;
  domainCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UrlEntry {
  id: number;
  listId: number;
  url: string;
  domain: string;
  label: string | null;
  tags: string[];
  createdAt: string;
}

export interface ImportReject {
  line: number;
  value: string;
  reason: string;
}

export interface ImportReport {
  format: 'txt' | 'csv';
  totalLines: number;
  accepted: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  rejects: ImportReject[];
  rejectsTruncated: boolean;
}

export interface TestRun {
  id: number;
  name: string;
  status: RunStatus;
  mode: RunMode;
  urlListId: number | null;
  urlListName: string | null;
  proxyId: number | null;
  proxyName: string | null;
  settings: RunSettings;
  profileCount: number;
  totalTasks: number;
  doneTasks: number;
  successTasks: number;
  failedTasks: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunProgress {
  runId: number;
  status: RunStatus;
  totalTasks: number;
  doneTasks: number;
  successTasks: number;
  failedTasks: number;
  runningTasks: number;
  /** Tasks completed per minute over the last ~30s. */
  throughputPerMin: number;
  etaSeconds: number | null;
}

export interface TaskResultDetails {
  title?: string | null;
  contentType?: string | null;
  jsRedirectSuspected?: boolean;
  viewportMeta?: string | null;
  cookies?: CookieInfo[];
  layout?: LayoutInfo | null;
  consoleErrors?: string[];
  failedRequests?: number;
  screenshot?: string | null;
  warnings?: string[];
  timings?: { firstByteMs?: number | null; domContentLoadedMs?: number | null; loadMs?: number | null };
}

export interface CookieInfo {
  name: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
  expires: string | null;
  value?: string;
}

export interface LayoutInfo {
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
  horizontalOverflow: boolean;
  hasViewportMeta: boolean;
  viewportMeta: string | null;
  mobileHost: boolean;
  smallTextRatio: number | null;
}

export interface TestTask {
  id: number;
  runId: number;
  urlId: number | null;
  url: string;
  domain: string;
  profileId: number | null;
  profileName: string | null;
  engine: TaskEngine;
  status: TaskStatus;
  attempts: number;
  finalUrl: string | null;
  finalStatus: number | null;
  redirectCount: number | null;
  totalTimeMs: number | null;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  result: TaskResultDetails | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RedirectHop {
  seq: number;
  url: string;
  statusCode: number | null;
  location: string | null;
  hopType: HopType;
  method: string;
  responseTimeMs: number | null;
  remoteAddress: string | null;
  headers: Record<string, string> | null;
  error: string | null;
}

export interface TaskDetail extends TestTask {
  hops: RedirectHop[];
  profile: DeviceProfile | null;
}

export interface RunSummary {
  runId: number;
  byStatus: Record<TaskStatus, number>;
  byErrorCode: { code: string; count: number }[];
  byFinalStatus: { status: number | null; count: number }[];
  byEngine: { engine: TaskEngine; count: number; success: number; avgTimeMs: number | null }[];
  byFormFactor: { formFactor: string; count: number; success: number; avgRedirects: number | null }[];
  topFinalDomains: { domain: string; count: number }[];
  slowest: { taskId: number; url: string; totalTimeMs: number; profileName: string | null }[];
  avgTimeMs: number | null;
  p95TimeMs: number | null;
  avgRedirects: number | null;
}

export interface DashboardStats {
  urls: number;
  urlLists: number;
  profiles: number;
  enabledProfiles: number;
  proxies: number;
  runs: number;
  activeRuns: number;
  tasksLast7Days: number;
  successRateLast7Days: number | null;
  daily: { date: string; success: number; failed: number; error: number }[];
  topErrors: { code: string; count: number }[];
}

export interface SystemInfo {
  version: string;
  node: string;
  platform: string;
  dataDir: string;
  dbSizeBytes: number;
  browsers: { engine: BrowserEngineName; installed: boolean; executablePath: string | null }[];
  browserSessions: { open: number; max: number; browsers: { key: string; contexts: number }[] };
  installCommand: string;
}

export type { AppSettings, RunSettings };

/* ------------------------------------------------------------------ */
/* Server-sent events                                                  */
/* ------------------------------------------------------------------ */

export type ServerEvent =
  | { type: 'run.updated'; run: TestRun }
  | { type: 'run.progress'; progress: RunProgress }
  | { type: 'run.deleted'; runId: number }
  | { type: 'task.completed'; runId: number; task: TestTask }
  | { type: 'profiles.changed' }
  | { type: 'urls.changed'; listId: number }
  | { type: 'proxies.changed' };
