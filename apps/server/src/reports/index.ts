import type { RedirectHop, RunSummary, TestRun, TestTask } from '@impressions/shared';
import type { RunRepository } from '../db/repositories/runs.js';

const PAGE = 500;

/** Yields a run's tasks with hops attached, in pages, without holding a DB cursor open. */
export function* tasksWithHops(runs: RunRepository, runId: number): Generator<TestTask & { hops: RedirectHop[] }> {
  let after = 0;
  for (;;) {
    const page = runs.tasksAfter(runId, after, PAGE);
    if (!page.length) return;
    const hops = runs.hopsForTasks(page.map((t) => t.id));
    for (const t of page) yield { ...t, hops: hops.get(t.id) ?? [] };
    after = page[page.length - 1]!.id;
  }
}

export const chainText = (hops: RedirectHop[]) =>
  hops.map((h) => `${h.statusCode ?? 'ERR'}${h.hopType === 'meta' || h.hopType === 'js' ? `(${h.hopType})` : ''} ${h.url}`).join(' -> ');

/* --------------------------------- CSV ---------------------------------- */

const CSV_COLUMNS = [
  'task_id',
  'url',
  'domain',
  'profile',
  'engine',
  'status',
  'final_status',
  'final_url',
  'redirect_count',
  'total_time_ms',
  'error_code',
  'error_message',
  'title',
  'cookies',
  'horizontal_overflow',
  'warnings',
  'redirect_chain',
  'finished_at',
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection (cells starting with = + - @).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 BOM + CRLF so the file opens cleanly in Excel on Windows. */
export function* csvReport(runs: RunRepository, runId: number): Generator<string> {
  yield '﻿' + CSV_COLUMNS.join(',') + '\r\n';
  let buf: string[] = [];
  for (const t of tasksWithHops(runs, runId)) {
    buf.push(
      [
        t.id,
        t.url,
        t.domain,
        t.profileName,
        t.engine,
        t.status,
        t.finalStatus,
        t.finalUrl,
        t.redirectCount,
        t.totalTimeMs,
        t.errorCode,
        t.errorMessage,
        t.result?.title,
        t.result?.cookies?.length ?? '',
        t.result?.layout ? (t.result.layout.horizontalOverflow ? 'yes' : 'no') : '',
        t.result?.warnings?.join(' | '),
        chainText(t.hops),
        t.finishedAt,
      ]
        .map(csvCell)
        .join(',') + '\r\n',
    );
    if (buf.length >= 200) {
      yield buf.join('');
      buf = [];
    }
  }
  if (buf.length) yield buf.join('');
}

/* --------------------------------- JSON --------------------------------- */

export function* jsonReport(runs: RunRepository, run: TestRun, summary: RunSummary): Generator<string> {
  yield `{"generatedAt":${JSON.stringify(new Date().toISOString())},"run":${JSON.stringify(run)},"summary":${JSON.stringify(summary)},"tasks":[`;
  let first = true;
  for (const t of tasksWithHops(runs, run.id)) {
    yield (first ? '\n' : ',\n') + JSON.stringify(t);
    first = false;
  }
  yield '\n]}\n';
}

/* --------------------------------- HTML --------------------------------- */

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const HTML_ROW_LIMIT = 5000;

export function* htmlReport(runs: RunRepository, run: TestRun, summary: RunSummary): Generator<string> {
  const pct = (n: number) => (run.doneTasks ? `${((n / run.doneTasks) * 100).toFixed(1)}%` : '–');
  yield `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(run.name)} – Redirect report</title>
<style>
:root{--bg:#f8fafc;--card:#fff;--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;--ok:#15803d;--warn:#b45309;--bad:#b91c1c;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#121a2e;--fg:#e2e8f0;--muted:#94a3b8;--line:#22304d;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--accent:#818cf8}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:1200px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}
.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}.card b{display:block;font-size:22px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;font-size:13px}th{font-weight:600;color:var(--muted)}
.success{color:var(--ok)}.failed{color:var(--warn)}.error{color:var(--bad)}.chain{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all}
.wrap{overflow-x:auto}details summary{cursor:pointer}
</style></head><body><main>
<h1>${esc(run.name)}</h1>
<div class="muted">Mode: ${esc(run.mode)} · Profiles: ${run.profileCount} · URL list: ${esc(run.urlListName ?? '–')} · Proxy: ${esc(run.proxyName ?? 'none')} · Generated ${esc(new Date().toISOString())}</div>
<div class="grid">
<div class="card"><span class="muted">Tasks</span><b>${run.doneTasks.toLocaleString()} / ${run.totalTasks.toLocaleString()}</b></div>
<div class="card"><span class="muted">Success</span><b class="success">${pct(run.successTasks)}</b></div>
<div class="card"><span class="muted">Failed / errors</span><b class="error">${run.failedTasks.toLocaleString()}</b></div>
<div class="card"><span class="muted">Avg time</span><b>${summary.avgTimeMs ?? '–'} ms</b></div>
<div class="card"><span class="muted">p95 time</span><b>${summary.p95TimeMs ?? '–'} ms</b></div>
<div class="card"><span class="muted">Avg redirects</span><b>${summary.avgRedirects ?? '–'}</b></div>
</div>`;

  yield `<h2>Errors</h2>${
    summary.byErrorCode.length
      ? `<table><tr><th>Code</th><th>Count</th></tr>${summary.byErrorCode.map((e) => `<tr><td>${esc(e.code)}</td><td>${e.count}</td></tr>`).join('')}</table>`
      : '<p class="muted">No errors.</p>'
  }`;
  yield `<h2>By form factor</h2><table><tr><th>Form factor</th><th>Tasks</th><th>Success</th><th>Avg redirects</th></tr>${summary.byFormFactor
    .map((f) => `<tr><td>${esc(f.formFactor)}</td><td>${f.count}</td><td>${f.success}</td><td>${f.avgRedirects ?? '–'}</td></tr>`)
    .join('')}</table>`;
  yield `<h2>Top final destinations</h2><table><tr><th>Host</th><th>Count</th></tr>${summary.topFinalDomains
    .map((d) => `<tr><td>${esc(d.domain)}</td><td>${d.count}</td></tr>`)
    .join('')}</table>`;

  yield `<h2>Results</h2><div class="wrap"><table><tr><th>#</th><th>URL</th><th>Profile</th><th>Engine</th><th>Status</th><th>Final</th><th>Hops</th><th>Time</th><th>Redirect chain</th></tr>`;
  let n = 0;
  for (const t of tasksWithHops(runs, run.id)) {
    if (++n > HTML_ROW_LIMIT) break;
    yield `<tr><td>${t.id}</td><td class="chain">${esc(t.url)}</td><td>${esc(t.profileName ?? '–')}</td><td>${t.engine}</td>
<td class="${t.status}">${t.status}${t.errorCode ? `<br><span class="muted">${esc(t.errorCode)}</span>` : ''}</td>
<td>${t.finalStatus ?? '–'}</td><td>${t.redirectCount ?? '–'}</td><td>${t.totalTimeMs ?? '–'} ms</td>
<td><details><summary class="chain">${esc(t.finalUrl ?? '–')}</summary><ol class="chain">${t.hops
      .map((h) => `<li>${h.statusCode ?? 'ERR'} <span class="muted">${h.hopType}</span> ${esc(h.url)}${h.responseTimeMs !== null ? ` <span class="muted">${h.responseTimeMs} ms</span>` : ''}${h.error ? ` <span class="error">${esc(h.error)}</span>` : ''}</li>`)
      .join('')}</ol></details></td></tr>`;
  }
  yield `</table></div>${n > HTML_ROW_LIMIT ? `<p class="muted">Showing the first ${HTML_ROW_LIMIT.toLocaleString()} results. Export CSV or JSON for the full data set.</p>` : ''}</main></body></html>`;
}
