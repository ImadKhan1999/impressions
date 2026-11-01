# Redirect & Compatibility Checker: Architecture

This document is the design of record for the application. It covers goals and
guardrails, the technology stack, the folder structure, every server module, the
database schema, the HTTP API, and the dashboard UI.

## 1. Purpose and guardrails

The checker answers one question for a list of URLs: *what does a real user on a
given device, browser and network actually get when they open this link?* It
records every redirect hop, the final landing page, timings, cookies, layout
characteristics and errors, and turns them into reports.

It is a **compatibility and redirect testing tool**, not a traffic generator.
These guardrails are part of the design and are enforced in code, not just in docs:

| Guardrail | Where it is enforced |
| --- | --- |
| Proxies are configured manually and **one proxy (or none) is pinned to a run**. There is no proxy pool, rotation or per-request cycling. | `test_runs.proxy_id` is a single nullable FK; the executor resolves it once per run. |
| Per-domain rate limiting is **always on** with conservative defaults (1 request/s, 2 concurrent per registrable domain) and hard upper caps (5 req/s, 4 concurrent). | `scheduler/domain-limiter.ts`, validated by shared zod schemas and re-clamped server-side. |
| Each `(URL, device profile, engine)` combination is tested **once per run**. URLs are de-duplicated on import. Retries happen only for transport failures (timeouts, resets), never for successful responses. | Unique index on `test_tasks(run_id, url_id, profile_id, engine)`; retry policy in `scheduler/run-executor.ts`. |
| Device profiles are a stored, curated **compatibility library**. A run uses the profiles the user deliberately selected. There is no fingerprint randomisation, per-request rotation, or bot-detection evasion (no `navigator.webdriver` patching, no stealth plugins). | `engines/browser` only uses Playwright's documented emulation options (UA, viewport, DPR, touch, locale, timezone). |
| The browser engine **never clicks, scrolls into or otherwise interacts** with page content, so it cannot click ads or fire monetisation events. It navigates, waits for the page to settle, and observes. | `engines/browser/browser-engine.ts` has no input APIs. |

## 2. Technology stack

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere (Node.js 20 or 22 LTS) | One language for server, UI and shared contracts; Playwright's first-class SDK is Node. |
| Repo layout | npm workspaces monorepo | `apps/server`, `apps/web`, `packages/shared`. npm ships with Node, so nothing extra to install on Windows. |
| HTTP server | Fastify 5 | Fast, schema-friendly, good error hooks, built-in logger (pino). |
| Validation | zod (shared package) | The same schemas validate API input on the server and forms in the UI. |
| Database | SQLite via `better-sqlite3`, WAL mode | Zero-ops, a single file, prebuilt Windows x64 binaries, synchronous API that is very fast for this workload. Handles hundreds of thousands of task rows easily. |
| HTTP engine | `node:http`/`node:https` + `http-proxy-agent`, `https-proxy-agent`, `socks-proxy-agent` | Full control over each hop (manual redirect following, per-hop timing via socket events) and proxy support for HTTP, HTTPS, SOCKS4/4a and SOCKS5/5h. |
| Cookies | `tough-cookie` | RFC 6265 cookie jar so redirect chains that set cookies behave like a browser. |
| Domains | `tldts` | Registrable-domain (eTLD+1) extraction for rate limiting. |
| Browser engine | Playwright (Chromium, Firefox, WebKit) | Real JS execution, client-side redirects, cookies, device emulation. |
| CSV | `csv-parse` / hand-rolled writer | Robust import (quotes, BOM, CRLF) and Excel-friendly export. |
| Live updates | Server-Sent Events | One-way progress stream, works through every proxy, trivial to reconnect. |
| UI | React 18, Vite, Tailwind CSS, TanStack Query, React Router, Recharts, lucide icons | Modern, fast dev loop, small production bundle served by Fastify. |
| Tests | Vitest (server + shared), local HTTP fixture server, real Chromium for browser-engine tests |

## 3. Folder structure

```
.
├── package.json                 # workspaces + top-level scripts (dev, build, start, test)
├── tsconfig.base.json
├── docs/
│   ├── ARCHITECTURE.md          # this file
│   └── WINDOWS.md               # Windows 10/11 install & troubleshooting
├── scripts/
│   ├── setup.mjs                # cross-platform: install browsers, create data dir
│   ├── windows/setup.ps1        # one-shot Windows installer helper
│   └── windows/start.cmd        # double-click launcher
├── packages/
│   └── shared/src/
│       ├── constants.ts         # enums, limits, defaults (rate-limit caps, etc.)
│       ├── schemas.ts           # zod schemas for every API payload
│       ├── types.ts             # DTO types inferred from schemas
│       └── index.ts
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts         # entry: load config, open DB, migrate, seed, listen
│   │   │   ├── app.ts           # Fastify instance, plugins, routes, static UI
│   │   │   ├── config.ts        # env + defaults, data directory resolution
│   │   │   ├── context.ts       # dependency container (db, services, managers)
│   │   │   ├── lib/             # errors, semaphore, async utils, paths, ids
│   │   │   ├── db/
│   │   │   │   ├── connection.ts
│   │   │   │   ├── migrate.ts
│   │   │   │   ├── migrations/  # 001_init.ts, ... (SQL embedded in TS so bundling is trivial)
│   │   │   │   └── repositories/ # profiles, proxies, urls, runs, tasks, hops, settings
│   │   │   ├── profiles/
│   │   │   │   ├── catalog/     # devices.ts, browsers.ts, os.ts (static catalogs)
│   │   │   │   ├── user-agent.ts # UA + client-hints builder
│   │   │   │   ├── generator.ts # catalog -> concrete profiles (combinatorial)
│   │   │   │   ├── engine-map.ts # profile -> Playwright engine
│   │   │   │   └── service.ts
│   │   │   ├── proxies/
│   │   │   │   ├── crypto.ts    # AES-256-GCM for stored proxy passwords
│   │   │   │   ├── agents.ts    # proxy config -> Node agent / Playwright proxy option
│   │   │   │   └── service.ts   # CRUD + connectivity test
│   │   │   ├── urls/
│   │   │   │   ├── normalize.ts
│   │   │   │   ├── parser.ts    # TXT + CSV import with per-line diagnostics
│   │   │   │   └── service.ts
│   │   │   ├── engines/
│   │   │   │   ├── types.ts     # EngineResult, Hop, error taxonomy
│   │   │   │   ├── http/        # redirect-engine.ts, html-sniff.ts
│   │   │   │   └── browser/     # browser-pool.ts, browser-engine.ts
│   │   │   ├── scheduler/
│   │   │   │   ├── domain-limiter.ts # token bucket + concurrency per domain
│   │   │   │   ├── task-queue.ts     # round-robin across domains
│   │   │   │   ├── run-executor.ts   # drives one run
│   │   │   │   └── run-manager.ts    # lifecycle, recovery, global limits
│   │   │   ├── events/bus.ts    # typed event emitter + SSE fan-out
│   │   │   ├── reports/         # csv.ts, json.ts, html.ts
│   │   │   └── api/
│   │   │       ├── errors.ts    # error -> HTTP mapping
│   │   │       └── routes/      # health, stats, profiles, proxies, urls, runs, tasks, settings, events
│   │   └── test/                # vitest suites + fixture server
│   └── web/
│       ├── index.html
│       └── src/
│           ├── main.tsx, App.tsx, routes.tsx
│           ├── api/             # typed client, query hooks, SSE hook
│           ├── components/      # layout shell, tables, badges, dialogs, charts, toasts
│           ├── features/
│           │   ├── dashboard/
│           │   ├── runs/        # list, new-run wizard, run detail, task drawer
│           │   ├── urls/        # lists, import dialog, URL table
│           │   ├── profiles/    # library, filters, editor, UA builder
│           │   ├── proxies/
│           │   └── settings/
│           └── lib/             # formatting, hooks, theme
└── data/                        # runtime (git-ignored): checker.db, artifacts/, secret.key
```

## 4. Key design: profiles are data, sessions are a bounded pool

Requirement 7 is the central architectural decision.

* A **device profile** is just a row (~1 KB). 10,000 profiles is ~10 MB in SQLite
  and costs nothing at runtime. The UI pages through them server-side with indexed
  filters (platform, browser, form factor, enabled, free text).
* A **browser session** is a Playwright `BrowserContext` created *on demand* for one
  task and closed when the task finishes. Contexts are cheap; browser *processes* are
  not, so the `BrowserPool` keeps at most one browser process per
  `(engine, proxy)` key, launched lazily and closed after an idle timeout.
* A global semaphore (`maxBrowserSessions`, default 4, cap 32) bounds how many
  contexts exist at once across all runs. A run with 10,000 profiles x 1,000 URLs is
  just 10M task rows streamed through a handful of live contexts.
* Tasks are fetched from SQLite in pages (`pending` rows, ordered), so memory stays
  flat regardless of run size.

```
 profiles (rows) ──┐
 urls (rows) ──────┼─► run planner ─► test_tasks (rows, pending)
 run settings ─────┘                       │ paged fetch
                                           ▼
                          TaskQueue (round-robin by domain)
                                           │
                       DomainLimiter (token bucket + per-domain concurrency)
                                           │
               global HTTP slots ──┬── global browser slots (semaphore)
                                   │            │
                             HttpEngine     BrowserPool ─► 1 browser per (engine, proxy)
                                   │            └─► new context per task, closed after
                                   ▼
                       ResultWriter (batched transactions) ─► EventBus ─► SSE ─► UI
```

## 5. Server modules

### config
Reads environment variables (`PORT`, `HOST`, `DATA_DIR`, `LOG_LEVEL`,
`OPEN_BROWSER`) with defaults. Default bind is `127.0.0.1:5310` (local tool; not
exposed on the LAN unless the user chooses to). The data directory defaults to
`./data` relative to the repo root and is created on start. All paths use
`node:path` so they are correct on Windows.

### db
`better-sqlite3` connection with `journal_mode=WAL`, `foreign_keys=ON`,
`busy_timeout=5000`, `synchronous=NORMAL`. Migrations are numbered TS modules
applied inside a transaction and recorded in `schema_migrations`. Repositories
expose typed methods and prepared statements; no SQL outside `db/`.

### profiles
* `catalog/` holds curated, static data: ~90 devices (phones, tablets, laptops,
  desktops across Android, iOS/iPadOS, Windows, macOS, Linux) with real viewport,
  screen and DPR values; OS version lists per platform; browser families with
  version ranges per platform (Chrome, Edge, Firefox, Safari, Samsung Internet,
  Opera).
* `user-agent.ts` builds a correct UA string (and `Sec-CH-UA*` client hints for
  Chromium browsers) from `(device, os version, browser, browser version)`.
* `generator.ts` expands the catalog into concrete profiles. The built-in seed
  produces a few thousand realistic combinations; the user can generate more
  through the UI ("Profile builder": pick devices x OS versions x browsers x
  versions) up to the 10,000 profile design target, or create/import custom ones.
* `engine-map.ts` maps a profile to a Playwright engine: Safari and all iOS
  browsers -> WebKit (iOS browsers all use WebKit), Firefox -> Firefox, everything
  else -> Chromium. Setting `engineStrategy = "chromium-only"` forces Chromium for
  machines that only installed Chromium.

### proxies
* Supported protocols: `http`, `https`, `socks4`, `socks5` (SOCKS4a/5h remote
  DNS selectable via a flag).
* Passwords are encrypted at rest with AES-256-GCM using a key generated once in
  `data/secret.key`. The API never returns passwords, only `hasPassword`.
* `agents.ts` converts a proxy into a Node agent for the HTTP engine and a
  Playwright `proxy` option for the browser engine, and reports unsupported
  combinations up front (Chromium cannot authenticate to SOCKS proxies, so that
  combination fails validation with a clear message instead of a confusing timeout).
* "Test proxy" performs one request through the proxy to a user-chosen URL and
  records latency, status and error.

### urls
* `normalize.ts`: trims, adds `https://` when the scheme is missing, lowercases
  scheme and host, removes default ports and fragments, rejects non-http(s)
  schemes and malformed hosts.
* `parser.ts`: TXT (one URL per line, `#` comments, blank lines ignored) and CSV
  (header detection, `url` column or first column, optional `label` and `tags`
  columns, quoted fields, UTF-8 BOM, CRLF). Returns accepted rows plus per-line
  rejects with reasons, so the import dialog can show exactly what was skipped.
* Imports are de-duplicated against the list by normalised URL and inserted in
  batched transactions (thousands of rows per transaction).

### engines/http (redirect engine)
* Follows redirects manually (`301, 302, 303, 307, 308`), up to `maxRedirects`
  (default 20), with method rewriting per RFC 9110 (303 -> GET, 301/302 POST -> GET).
* Per hop it records URL, status, `Location`, response time (TTFB) and total time,
  remote IP, selected headers (`server`, `content-type`, `cache-control`,
  `set-cookie` names), and the hop type.
* Sniffs the first 256 KB of HTML responses for `<meta http-equiv="refresh">` and
  follows it (hop type `meta`), and flags likely JavaScript redirects
  (`location.href=`, `location.replace(`) as `jsSuspected` so the report can
  recommend browser mode.
* Detects redirect loops, enforces per-hop and overall timeouts, decodes
  gzip/deflate/brotli, and maps failures to a stable error taxonomy
  (`DNS_FAILURE`, `CONNECTION_REFUSED`, `CONNECTION_RESET`, `TIMEOUT`, `TLS_ERROR`,
  `PROXY_ERROR`, `TOO_MANY_REDIRECTS`, `REDIRECT_LOOP`, `INVALID_REDIRECT`, `HTTP_ERROR`).
* Uses the profile's UA and Accept-Language so server-side device detection is
  exercised.

### engines/browser
* `BrowserPool`: lazily launches browsers keyed by `(engine, proxyId)`, tracks
  open contexts, closes idle browsers, restarts crashed ones, and shuts down
  cleanly on exit.
* `BrowserEngine.run(task)`: creates a context from the profile (UA, viewport,
  screen, DPR, `isMobile`, `hasTouch`, locale, timezone, extra headers), opens a
  page, and navigates with `waitUntil` (default `load`). It records:
  * every **main-frame navigation request**, including HTTP redirects (via
    `request.redirectedFrom()` chains) and client-side navigations (JS or meta
    refresh, distinguished by inspecting the previous document for a meta
    refresh tag), with status and timing from `request.timing()`;
  * a settle phase: waits for network idle up to `settleTimeoutMs` and then a
    configurable quiet period so delayed JS redirects are captured;
  * the final URL, HTTP status, title, cookies (name, domain, flags, expiry;
    values are not stored unless enabled), console errors, failed requests;
  * layout metrics: viewport vs document width (horizontal overflow), presence
    of `<meta name="viewport">`, detected mobile site (m-dot host or responsive
    breakpoint), font-size sanity;
  * optional screenshot (viewport, JPEG) saved to `data/artifacts/<run>/<task>.jpg`.
* No input APIs are used; the engine observes only.

### scheduler
* `DomainLimiter`: per registrable domain token bucket (`requestsPerSecond`)
  plus a concurrency counter (`maxConcurrentPerDomain`). Both are clamped to the
  hard caps from `shared/constants.ts`.
* `TaskQueue`: holds a window of pending tasks grouped by domain and hands them out
  round-robin, skipping domains that are currently throttled, so one big domain
  can't starve others or cause head-of-line blocking.
* `RunExecutor`: drives one run; pulls pages of pending tasks, acquires domain +
  engine slots, executes, writes results in batched transactions, emits progress
  (throttled to ~4 Hz), and supports pause/resume/cancel with prompt abort of
  in-flight work via `AbortSignal`.
* `RunManager`: owns all executors, enforces global limits (`maxConcurrentRuns`),
  and on start-up recovers runs that were `running` when the process died
  (marks them `paused`, resets `running` tasks to `pending`).

### events
Typed in-process event bus (`run.updated`, `run.progress`, `task.completed`,
`profile.changed`, ...). The SSE route subscribes per client with heartbeat
pings every 15s and supports a `runId` filter.

### reports
CSV (UTF-8 with BOM, CRLF line endings, so it opens correctly in Excel on
Windows), JSON (full data including hops), and a self-contained HTML report
(summary, status breakdown, slowest URLs, error table, per-task redirect chains).
Exports stream rows so large runs don't build huge strings in memory.

### api
REST under `/api`, JSON in/out, zod-validated. Errors use one shape:
`{ error: { code, message, details? } }`. Listing endpoints use
`page`/`pageSize` with a `total`.

| Area | Endpoints |
| --- | --- |
| System | `GET /api/health`, `GET /api/stats`, `GET /api/system` (browser install status, data dir, versions), `GET /api/events` (SSE) |
| Settings | `GET /api/settings`, `PUT /api/settings` |
| Profiles | `GET /api/profiles` (filters + paging), `GET /api/profiles/facets`, `GET /api/profiles/:id`, `POST /api/profiles`, `PATCH /api/profiles/:id`, `DELETE /api/profiles/:id`, `POST /api/profiles/bulk`, `POST /api/profiles/generate`, `GET /api/profiles/catalog`, `POST /api/profiles/import`, `GET /api/profiles/export` |
| Proxies | `GET/POST /api/proxies`, `PATCH/DELETE /api/proxies/:id`, `POST /api/proxies/:id/test` |
| URL lists | `GET/POST /api/url-lists`, `GET/PATCH/DELETE /api/url-lists/:id`, `GET /api/url-lists/:id/urls`, `POST /api/url-lists/:id/urls`, `POST /api/url-lists/:id/import` (multipart), `POST /api/url-lists/:id/urls/delete` |
| Runs | `GET/POST /api/runs`, `GET/DELETE /api/runs/:id`, `POST /api/runs/:id/{start,pause,resume,cancel,duplicate}`, `GET /api/runs/:id/tasks`, `GET /api/runs/:id/summary`, `GET /api/runs/:id/export?format=csv\|json\|html` |
| Tasks | `GET /api/tasks/:id` (with hops), `GET /api/artifacts/:runId/:file` |

## 6. Database schema

All timestamps are ISO-8601 UTC strings. JSON columns are TEXT validated in the
repository layer.

```sql
CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL              -- JSON
);

CREATE TABLE device_profiles (
  id                  INTEGER PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('android','ios','windows','macos','linux')),
  form_factor         TEXT NOT NULL CHECK (form_factor IN ('mobile','tablet','desktop')),
  vendor              TEXT,
  model               TEXT,
  os_version          TEXT NOT NULL,
  browser             TEXT NOT NULL CHECK (browser IN ('chrome','edge','firefox','safari','samsung','opera')),
  browser_version     TEXT NOT NULL,
  engine              TEXT NOT NULL CHECK (engine IN ('chromium','firefox','webkit')),
  user_agent          TEXT NOT NULL,
  client_hints        TEXT,         -- JSON: Sec-CH-UA headers for Chromium
  viewport_width      INTEGER NOT NULL,
  viewport_height     INTEGER NOT NULL,
  screen_width        INTEGER NOT NULL,
  screen_height       INTEGER NOT NULL,
  device_scale_factor REAL    NOT NULL DEFAULT 1,
  is_mobile           INTEGER NOT NULL DEFAULT 0,
  has_touch           INTEGER NOT NULL DEFAULT 0,
  locale              TEXT NOT NULL DEFAULT 'en-US',
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  tags                TEXT NOT NULL DEFAULT '[]',  -- JSON array
  source              TEXT NOT NULL DEFAULT 'custom' CHECK (source IN ('builtin','generated','custom','imported')),
  enabled             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_profiles_filter ON device_profiles(enabled, platform, browser, form_factor);
CREATE INDEX idx_profiles_name   ON device_profiles(name);

CREATE TABLE proxies (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT NOT NULL UNIQUE,
  protocol             TEXT NOT NULL CHECK (protocol IN ('http','https','socks4','socks5')),
  host                 TEXT NOT NULL,
  port                 INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  username             TEXT,
  password_enc         TEXT,        -- AES-256-GCM, base64 (iv:tag:ciphertext)
  remote_dns           INTEGER NOT NULL DEFAULT 1,  -- socks4a / socks5h
  notes                TEXT,
  last_checked_at      TEXT,
  last_check_ok        INTEGER,
  last_check_latency_ms INTEGER,
  last_check_error     TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE url_lists (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE urls (
  id              INTEGER PRIMARY KEY,
  list_id         INTEGER NOT NULL REFERENCES url_lists(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,      -- normalised URL that is requested
  domain          TEXT NOT NULL,      -- registrable domain, used for rate limiting
  label           TEXT,
  tags            TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL,
  UNIQUE (list_id, url)
);
CREATE INDEX idx_urls_list_domain ON urls(list_id, domain);

CREATE TABLE test_runs (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('draft','queued','running','paused','completed','cancelled','failed')),
  mode             TEXT NOT NULL CHECK (mode IN ('http','browser','both')),
  url_list_id      INTEGER REFERENCES url_lists(id) ON DELETE SET NULL,
  proxy_id         INTEGER REFERENCES proxies(id) ON DELETE SET NULL,  -- one proxy per run, never rotated
  settings         TEXT NOT NULL,     -- JSON RunSettings (concurrency, rate limits, timeouts, capture options)
  total_tasks      INTEGER NOT NULL DEFAULT 0,
  done_tasks       INTEGER NOT NULL DEFAULT 0,
  success_tasks    INTEGER NOT NULL DEFAULT 0,
  failed_tasks     INTEGER NOT NULL DEFAULT 0,
  error            TEXT,
  created_at       TEXT NOT NULL,
  started_at       TEXT,
  finished_at      TEXT
);
CREATE INDEX idx_runs_status ON test_runs(status, created_at);

CREATE TABLE test_run_profiles (
  run_id      INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  profile_id  INTEGER NOT NULL REFERENCES device_profiles(id) ON DELETE CASCADE,
  snapshot    TEXT NOT NULL,           -- JSON copy of the profile at run creation (history stays accurate after edits)
  PRIMARY KEY (run_id, profile_id)
);

CREATE TABLE test_tasks (
  id               INTEGER PRIMARY KEY,
  run_id           INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  url_id           INTEGER,
  url              TEXT NOT NULL,
  domain           TEXT NOT NULL,
  profile_id       INTEGER,
  engine           TEXT NOT NULL CHECK (engine IN ('http','browser')),
  status           TEXT NOT NULL CHECK (status IN ('pending','running','success','failed','error','cancelled')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  final_url        TEXT,
  final_status     INTEGER,
  redirect_count   INTEGER,
  total_time_ms    INTEGER,
  error_code       TEXT,
  error_message    TEXT,
  result           TEXT,               -- JSON: title, cookies, layout, console errors, screenshot path, warnings
  started_at       TEXT,
  finished_at      TEXT,
  UNIQUE (run_id, url_id, profile_id, engine)   -- each combination tested once per run
);
CREATE INDEX idx_tasks_run_status ON test_tasks(run_id, status, id);
CREATE INDEX idx_tasks_run_domain ON test_tasks(run_id, domain);

CREATE TABLE redirect_hops (
  id               INTEGER PRIMARY KEY,
  task_id          INTEGER NOT NULL REFERENCES test_tasks(id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  url              TEXT NOT NULL,
  status_code      INTEGER,
  location         TEXT,
  hop_type         TEXT NOT NULL CHECK (hop_type IN ('initial','http','meta','js','final')),
  method           TEXT NOT NULL DEFAULT 'GET',
  response_time_ms INTEGER,
  remote_address   TEXT,
  headers          TEXT,               -- JSON subset
  error            TEXT,
  UNIQUE (task_id, seq)
);
```

Task status meaning: `success` = final response 2xx/3xx-terminal; `failed` = the
chain completed but ended in 4xx/5xx; `error` = transport/engine error.

## 7. Run settings

```ts
interface RunSettings {
  concurrency: number;              // global parallel tasks for this run (default 8, max 64)
  browserConcurrency: number;       // parallel browser contexts (default 4, max 32)
  requestsPerSecondPerDomain: number; // default 1, min 0.1, max 5
  maxConcurrentPerDomain: number;   // default 2, max 4
  timeoutMs: number;                // whole task (default 30000)
  maxRedirects: number;             // default 20
  retries: number;                  // transport errors only (default 1, max 3)
  browser: {
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
    settleMs: number;               // quiet period to catch delayed JS redirects (default 2500)
    screenshot: boolean;
    captureCookieValues: boolean;   // default false (privacy)
  };
  http: { followMetaRefresh: boolean; method: 'GET' | 'HEAD' };
}
```

## 8. UI design

A left sidebar shell with a top bar (global search, live run indicator,
theme toggle). Light and dark themes. Dense but calm data tables, status pills,
and toasts for every mutation result.

| Page | Contents |
| --- | --- |
| **Dashboard** | KPI cards (URLs, profiles, runs, success rate over last 7 days), active runs with live progress bars and throughput, status breakdown donut, error code bar chart, recent runs table. |
| **Test runs** | Filterable run history table (status, mode, progress, success %, duration). "New test run" wizard: 1) URLs (pick list) 2) Profiles (faceted picker with select-all-matching, preview of task count) 3) Network (no proxy or one proxy) 4) Engine and limits (mode, concurrency, rate limits with caps shown, timeouts, capture options) 5) Review. |
| **Run detail** | Header with status, controls (start/pause/resume/cancel/duplicate), live progress, ETA, throughput sparkline; tabs: *Results* (virtualised task table with status/engine/profile/domain filters), *Summary* (status breakdown, top errors, slowest domains, final-domain distribution, mobile vs desktop comparison), *Export* (CSV/JSON/HTML). Task drawer: redirect chain timeline (hop type, status, URL, time), final page info, cookies, layout metrics, console errors, screenshot. |
| **URL lists** | Lists with counts; list detail with searchable paginated URL table, add URLs box, drag-and-drop TXT/CSV import with an import report (accepted, duplicates, rejected with line numbers). |
| **Device profiles** | Server-paginated library (handles 10k+) with facets (platform, form factor, browser, engine, source, enabled), bulk enable/disable/delete, create/edit form with live UA preview, Profile builder (devices x OS versions x browsers x versions -> preview count -> generate), JSON import/export. |
| **Proxies** | Proxy table with protocol, host, last test result; add/edit dialog (password write-only); test button. Banner explaining one-proxy-per-run. |
| **Settings** | Default run settings, engine strategy, browser installation status (with the exact install command), data directory, retention (delete runs older than N days). |

## 9. Error handling

* Typed `AppError` (`code`, `httpStatus`, `details`) thrown from services; one
  Fastify error handler maps them (zod errors -> 400 with field details, SQLite
  constraint errors -> 409, unknown -> 500 with a logged correlation id).
* Engines never throw for site problems; they return a result with an error
  code so one bad URL never kills a run. Engine *infrastructure* failures (browser
  crash) retry the task once on a fresh browser and mark the browser unhealthy.
* Process-level: `unhandledRejection` is logged; `SIGINT`/`SIGTERM` (and Ctrl+C on
  Windows) pause active runs, close browsers and the DB cleanly.
* The UI shows API errors in toasts with the server message, has error
  boundaries per page, and handles SSE reconnects automatically.

## 10. Windows 10/11 support

* Pure Node + npm; no bash, `rm -rf` or POSIX-only scripts. Scripts are `.mjs`.
* `better-sqlite3` ships prebuilt win32-x64 binaries for Node 20/22 LTS.
* All filesystem paths go through `node:path`; artifact filenames are sanitised.
* Playwright browsers are installed with `npm run setup` (wraps
  `playwright install chromium firefox webkit`); WebKit and Firefox are optional.
* `scripts/windows/start.cmd` launches the app and opens the dashboard;
  `scripts/windows/setup.ps1` checks the Node version and runs setup.
* CSV exports use a UTF-8 BOM and CRLF for Excel. TXT/CSV imports accept CRLF,
  UTF-8 with or without BOM, and UTF-16 LE (Notepad's "Unicode" encoding).
* The server binds to `127.0.0.1`, which avoids the Windows Defender Firewall prompt.

## 11. Implementation stages

1. Scaffold, shared package, config, database and migrations.
2. Device profile catalog, UA builder, generator and seed.
3. HTTP redirect engine and manual proxy support.
4. Playwright browser engine and bounded browser pool.
5. Scheduler: domain limiter, task queue, run executor and manager.
6. REST API, SSE, URL import, reports.
7. Dashboard UI.
8. Windows scripts, docs and tests.
