# Redirect & Compatibility Checker

A local web application for checking how URLs behave across devices, browsers
and networks. It follows every redirect hop (HTTP, meta refresh and JavaScript),
renders pages in real browser engines with device emulation, and records the
status, timing, cookies, final landing page and layout of every hop, so that
you can find broken links, wrong mobile/desktop routing, region-specific redirects and
slow chains before your users do.

* **Device profile library.** About 1,900 built-in profiles across Android,
  iOS/iPadOS, Windows, macOS and Linux (130 devices × browser × version), with a
  builder for your own combinations and room for 25,000 stored profiles.
* **Two engines.** A fast HTTP engine follows redirects hop by hop with exact
  status codes and headers. A Playwright browser engine (Chromium, Firefox,
  WebKit) captures JavaScript redirects, cookies, landing pages, mobile vs
  desktop layout, console errors and optional screenshots.
* **Network testing.** Manually configured HTTP, HTTPS, SOCKS4(a) and SOCKS5(h)
  proxies with encrypted credentials and a connectivity test. You choose one
  proxy (or a direct connection) for each run.
* **Bulk URLs.** Import thousands of URLs from TXT or CSV files (UTF-8 or UTF-16,
  `,` `;` or tab separated), with normalisation and de-duplication.
* **Responsible by default.** Requests are rate limited per registrable domain
  (1 request/second and 2 at a time by default, capped at 5/s and 4). Each
  URL × profile × engine pair is tested exactly once per run. The app never
  clicks page content and never rotates proxies or fingerprints.
* **Dashboard.** Live progress, run history, filters, a hop-by-hop task
  inspector, summaries (status mix, top errors, slowest domains, mobile vs
  desktop destinations) and CSV/JSON/HTML report export.
* **Windows ready.** Built for Windows 10 and 11, with double-click setup
  and start scripts. See [docs/WINDOWS.md](docs/WINDOWS.md).

## Quick start

Requires Node.js 22 LTS (20.19 or later).

```bash
npm ci
npm run setup      # prepares ./data and downloads Chromium, Firefox and WebKit
npm run build
npm start          # http://127.0.0.1:5310
```

`npm run setup -- --chromium-only` downloads only Chromium. In that case set
**Settings → Engine strategy** to **Chromium only**.

**Windows:** double-click `scripts\windows\setup.cmd`, then
`scripts\windows\start.cmd`. See [docs/WINDOWS.md](docs/WINDOWS.md) for details and
troubleshooting.

## Using the app

1. **URL lists.** Create a list and import a `.txt` (one URL per line, an
   optional label after the URL) or `.csv` file (a `url` column, plus optional
   `label` and `tags` columns). URLs without a scheme get `https://`, and
   duplicates are skipped.
2. **Device profiles.** Browse and filter the built-in library, enable or
   disable profiles, edit them, or use the **builder** to generate device ×
   browser × version combinations. Profiles can be exported and imported as JSON.
3. **Proxies (optional).** Add the proxies you are authorised to test through
   and use **Test** to check reachability.
4. **New run.** Pick a URL list, the profiles (an explicit selection or a saved
   filter), the mode (HTTP, browser, or both), one proxy or a direct
   connection, and the limits. The wizard shows the task count before you start.
5. **Watch and review.** Progress updates live. Open any task to see its full
   redirect chain. Runs can be paused, resumed, cancelled and duplicated.
6. **Export.** CSV (one row per task, Excel friendly), JSON (full detail,
   including every hop) or a self-contained HTML report.

### How the engines differ

| | HTTP engine | Browser engine |
|---|---|---|
| Redirects | 3xx, `Refresh` header, meta refresh | 3xx, meta refresh, JavaScript (including delayed) |
| Device emulation | User-Agent and client-hint headers | Full: UA, viewport, DPR, touch, locale, timezone |
| Cookies | Captured from `Set-Cookie` | Browser cookie jar after the page settles |
| Layout | — | Viewport meta, horizontal overflow, document size |
| Cost | Milliseconds, low memory | Seconds, ~150–250 MB per open session |

Run in **both** modes to compare what a crawler sees with what a real browser
lands on.

### Scale: profiles vs. browser sessions

Stored profiles are only data. A run with 10,000 profiles does not open 10,000
browsers. Tasks wait in a queue and a bounded pool opens at most
**Settings → Maximum open browser sessions** browser contexts at a time
(4 by default) across all runs. It keeps one browser process per engine and
proxy, gives every task a fresh isolated context, and closes idle browsers
automatically. Results are written in batches, and the task table is paginated
on the server, so runs of up to a million tasks stay responsive.

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` | `5310` | HTTP port |
| `HOST` | `127.0.0.1` | Listen address (keep it local) |
| `DATA_DIR` | `./data` | SQLite database, encryption key, screenshots |
| `OPEN_BROWSER` | `0` | Open the dashboard on start |
| `LOG_LEVEL` | `info` | `debug` · `info` · `warn` · `error` |
| `PRETTY_LOGS` | when attached to a terminal | Human-readable logs |

Everything else, such as default run limits, browser session limits, engine
strategy, headless mode and result retention, is under **Settings** in the app.

`data/secret.key` encrypts stored proxy passwords (AES-256-GCM). Back it up together with
`data/checker.db`.

## Development

```bash
npm run dev        # API with reload on :5310 + Vite on http://127.0.0.1:5173
npm test           # server tests: HTTP engine, browser engine, API (uses Chromium)
npm run typecheck
```

```
apps/server     Fastify API, SQLite, HTTP + browser engines, scheduler, reports
apps/web        React dashboard (Vite, Tailwind, TanStack Query)
packages/shared Zod schemas, types and limits shared by both
scripts/        setup, dev runner, Windows launchers
docs/           ARCHITECTURE.md (design, schema, API), WINDOWS.md
```

The design, database schema, API reference and module overview are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Responsible use

This tool is for checking links and destinations you own or are authorised to
test. It is deliberately not a traffic generator:

* Per-domain rate limits are always on and cannot exceed 5 requests/second.
* Each URL is requested once per profile and engine in a run, and failed tasks are retried
  only on transient network errors.
* Proxies are fixed per run and never rotated. Device profiles are
  chosen deliberately and never randomised per request.
* Browser runs only observe pages: they do not click, scroll to trigger
  content, or interact with ads. Dialogs are dismissed and pop-ups closed.
