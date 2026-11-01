# Running on Windows 10 and Windows 11

The checker is a plain Node.js application with no Bash, WSL or build tools
required. Everything below works from an ordinary user account.

## Requirements

| | |
|---|---|
| Windows | 10 (21H2 or later) or 11, 64-bit |
| Node.js | 22 LTS recommended (20.19 or later works) |
| Disk | ~300 MB for dependencies, plus ~150 MB per browser engine |
| Memory | 4 GB minimum; allow ~150–250 MB per open browser session |

Install Node.js from <https://nodejs.org/> or with `winget install OpenJS.NodeJS.LTS`.
Open a **new** terminal afterwards so `node` is on your `PATH`.

## Install

1. Download or clone the repository to a short path, for example `C:\checker`.
2. Double-click **`scripts\windows\setup.cmd`**.

   This checks Node.js, runs `npm ci`, downloads the Playwright browser engines
   (Chromium, Firefox and WebKit) and builds the app. To download Chromium only:

   ```bat
   scripts\windows\setup.cmd -ChromiumOnly
   ```

   If you prefer a terminal:

   ```powershell
   npm ci
   npm run setup          # or: npm run setup -- --chromium-only
   npm run build
   ```

## Start

Double-click **`scripts\windows\start.cmd`**. It builds the app if needed, starts
the server and opens <http://127.0.0.1:5310> in your default browser. Keep the
window open while you work; close it (or press Ctrl+C) to stop.

From a terminal: `npm start`.

Stopping the app pauses active runs. They show as **paused** on the next start
and continue where they left off when you press **Resume**; finished tasks are
never repeated.

## Where data is stored

Everything lives in the `data\` folder inside the project:

| File | Contents |
|---|---|
| `data\checker.db` | SQLite database (profiles, URL lists, runs, results) |
| `data\secret.key` | Key that encrypts stored proxy passwords. Back it up with the database; without it saved proxy passwords must be re-entered. |
| `data\artifacts\` | Screenshots taken by browser runs |

Set `DATA_DIR` to keep data elsewhere, e.g. on another drive:

```bat
set DATA_DIR=D:\checker-data
npm start
```

To back up, stop the app and copy the whole `data` folder.

## Configuration

Set these as environment variables before `npm start` (or edit `start.cmd`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5310` | Dashboard port |
| `HOST` | `127.0.0.1` | Listen address. Keep the default: other addresses expose the app to your network and trigger a firewall prompt. |
| `DATA_DIR` | `<project>\data` | Database and artifact folder |
| `OPEN_BROWSER` | `1` in `start.cmd` | Open the dashboard on start |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Importing URL files

TXT and CSV files saved by Notepad or Excel import directly:

* UTF-8 (with or without BOM) and UTF-16 ("Unicode" in Notepad) are detected.
* CSV files may use `,` `;` or tab separators (Excel in many European locales saves with `;`).
* CRLF and LF line endings are both fine.

CSV exports include a BOM and CRLF line endings so Excel opens them with the
right encoding. Cells that start with `=`, `+`, `-` or `@` are escaped so a
malicious URL cannot run a spreadsheet formula.

## Troubleshooting

**"node is not recognized"** — Node.js is not installed or the terminal was
opened before installing it. Install Node.js and open a new terminal.

**"running scripts is disabled on this system"** — run the `.cmd` files instead of
the `.ps1` file; they start PowerShell with `-ExecutionPolicy Bypass` for that
script only.

**`Port 5310 is already in use`** — another copy is running (check the taskbar),
or another program uses the port. Close it, or `set PORT=5320` before starting.

**"The ... browser is not installed"** or a run is refused with
`BROWSER_NOT_INSTALLED` — run `npm run setup`. If you only installed Chromium,
open **Settings → Engine strategy** and choose **Chromium only**; Safari and
Firefox profiles are then emulated in Chromium.

**Browser download fails behind a corporate proxy** — set the proxy for the
download only, then retry:

```bat
set HTTPS_PROXY=http://proxy.corp.example:8080
npm run setup
```

**`npm ci` fails with path-length errors (`ENAMETOOLONG`)** — move the project
closer to the drive root (e.g. `C:\checker`) or enable long paths
(`Computer Configuration → Administrative Templates → System → Filesystem →
Enable Win32 long paths`).

**`better-sqlite3` fails to load** — this happens when `node_modules` was copied
from another machine or Node.js was upgraded. Run `npm rebuild better-sqlite3`, or
delete `node_modules` and run setup again.

**Antivirus slows down browser runs** — some products scan every new browser
process. Excluding the Playwright browser folder
(`%LOCALAPPDATA%\ms-playwright`) usually helps; ask your IT team first.

**Headed mode** — turn off **Settings → Headless browsers** to watch the browser
windows while debugging. Keep browser sessions low (1–2) when doing this.
