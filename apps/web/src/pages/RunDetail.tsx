import {
  ArrowLeft,
  Ban,
  Copy,
  Cookie,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Pause,
  Play,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { TASK_ENGINES, TASK_STATUSES, type RedirectHop, type TaskDetail } from '@impressions/shared';
import { useDeleteRun, useRun, useRunAction, useRunSummary, useTask, useTasks, type TaskListQuery } from '../api/hooks';
import { useServerEvents } from '../api/events';
import { RunProgressBar } from '../components/RunBits';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ChipFilter,
  ConfirmDialog,
  Drawer,
  EmptyState,
  HttpStatus,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Pagination,
  RunStatusBadge,
  Stat,
  Table,
  Tabs,
  Td,
  TaskStatusBadge,
  Th,
  cx,
  useDebounced,
  useToast,
} from '../components/ui';
import { BROWSER_LABEL, FORM_LABEL, MODE_LABEL, PLATFORM_LABEL, fmtDate, fmtDuration, fmtMs, fmtNum, fmtPct, runDuration, shortUrl } from '../lib/format';

const STATUS_COLORS: Record<string, string> = { success: '#10b981', failed: '#f59e0b', error: '#f43f5e', cancelled: '#94a3b8', pending: '#cbd5e1', running: '#6366f1' };
const HOP_TONE: Record<string, 'gray' | 'blue' | 'violet' | 'amber'> = { initial: 'gray', http: 'blue', meta: 'violet', js: 'amber', final: 'gray' };

export function RunDetail() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const toast = useToast();
  const { data, isLoading, error } = useRun(id);
  useServerEvents(id);
  const action = useRunAction();
  const del = useDeleteRun();
  const [tab, setTab] = useState<'results' | 'summary' | 'export'>('results');
  const [taskId, setTaskId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);

  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <EmptyState title="Run not found" description={error instanceof Error ? error.message : undefined} action={<Link to="/runs"><Button>Back to runs</Button></Link>} />;
  const { run, progress } = data;
  const live = run.status === 'running' || run.status === 'queued';

  const doAction = async (a: 'start' | 'pause' | 'resume' | 'cancel' | 'duplicate') => {
    try {
      const r = await action.mutateAsync({ id, action: a });
      if (a === 'duplicate') {
        toast.success('Run duplicated', 'The copy is saved as a draft.');
        navigate(`/runs/${r.id}`);
      }
    } catch (e) {
      toast.error(`Could not ${a} the run`, e);
    }
    setConfirm(null);
  };

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {run.name} <RunStatusBadge status={run.status} />
          </span>
        }
        description={
          <span>
            #{run.id} · {MODE_LABEL[run.mode]} · {fmtNum(run.profileCount)} profiles ·{' '}
            {run.urlListId ? <Link className="hover:underline" to={`/urls/${run.urlListId}`}>{run.urlListName}</Link> : 'deleted list'} ·{' '}
            {run.proxyName ? `via ${run.proxyName}` : 'direct connection'}
          </span>
        }
        actions={
          <>
            <Link to="/runs">
              <Button variant="ghost" icon={<ArrowLeft className="size-4" />}>Runs</Button>
            </Link>
            {run.status === 'draft' && (
              <Button variant="primary" icon={<Play className="size-4" />} loading={action.isPending} onClick={() => doAction('start')}>Start</Button>
            )}
            {run.status === 'paused' && (
              <Button variant="primary" icon={<Play className="size-4" />} loading={action.isPending} onClick={() => doAction('resume')}>Resume</Button>
            )}
            {live && <Button icon={<Pause className="size-4" />} loading={action.isPending} onClick={() => doAction('pause')}>Pause</Button>}
            {(live || run.status === 'paused' || run.status === 'draft') && (
              <Button icon={<Ban className="size-4" />} onClick={() => setConfirm('cancel')}>Cancel</Button>
            )}
            <Button icon={<Copy className="size-4" />} onClick={() => doAction('duplicate')}>Duplicate</Button>
            {!live && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirm('delete')} aria-label="Delete run" />}
          </>
        }
      />

      {run.error && <Notice tone="warn" className="mb-4">{run.error}</Notice>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card className="col-span-2 p-4">
          <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
            <span>Progress</span>
            <span className="tabular">{runDuration(run.startedAt, run.finishedAt)}</span>
          </div>
          <RunProgressBar run={run} progress={progress} />
        </Card>
        <Stat label="Successful" value={fmtNum(run.successTasks)} sub={fmtPct(run.doneTasks ? run.successTasks / run.doneTasks : null)} />
        <Stat label="Failed / errors" value={fmtNum(run.failedTasks)} />
        <Stat label="In flight" value={fmtNum(progress?.runningTasks ?? 0)} sub={progress?.etaSeconds ? `ETA ${fmtDuration(progress.etaSeconds)}` : live ? 'measuring…' : '—'} />
      </div>

      <div className="mt-6">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'results', label: 'Results', count: run.doneTasks },
            { value: 'summary', label: 'Summary' },
            { value: 'export', label: 'Export' },
          ]}
        />
      </div>
      <div className="mt-4">
        {tab === 'results' && <ResultsTab runId={id} live={live} onOpen={setTaskId} />}
        {tab === 'summary' && <SummaryTab runId={id} live={live} onOpen={setTaskId} />}
        {tab === 'export' && <ExportTab runId={id} />}
      </div>

      <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} />

      <ConfirmDialog
        open={confirm === 'cancel'}
        title="Cancel this run?"
        message="Pending tasks will be marked as cancelled. Results recorded so far are kept. This cannot be resumed."
        confirmLabel="Cancel run"
        danger
        loading={action.isPending}
        onConfirm={() => doAction('cancel')}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this run?"
        message="The run, its results, redirect chains and screenshots will be permanently deleted."
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(id);
            toast.success('Run deleted');
            navigate('/runs');
          } catch (e) {
            toast.error('Could not delete the run', e);
            setConfirm(null);
          }
        }}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}

function ResultsTab({ runId, live, onOpen }: { runId: number; live: boolean; onOpen: (id: number) => void }) {
  const [status, setStatus] = useState<string[]>([]);
  const [engine, setEngine] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ sort: NonNullable<TaskListQuery['sort']>; order: 'asc' | 'desc' }>({ sort: 'id', order: 'desc' });
  const q = useDebounced(search);
  const query: TaskListQuery = {
    page,
    pageSize: 50,
    status: status.length ? status : ['success', 'failed', 'error', 'running', 'cancelled'],
    engine,
    q: q || undefined,
    ...sort,
  };
  const { data, isLoading } = useTasks(runId, query, live);
  const sortBy = (col: NonNullable<TaskListQuery['sort']>) =>
    setSort((s) => ({ sort: col, order: s.sort === col && s.order === 'desc' ? 'asc' : 'desc' }));
  const SortTh = ({ col, children, className }: { col: NonNullable<TaskListQuery['sort']>; children: React.ReactNode; className?: string }) => (
    <Th className={className}>
      <button className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white" onClick={() => sortBy(col)}>
        {children}
        {sort.sort === col && <span>{sort.order === 'desc' ? '↓' : '↑'}</span>}
      </button>
    </Th>
  );

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
          <Input className="pl-9" placeholder="Filter by URL or final URL" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <ChipFilter label="Status" options={TASK_STATUSES} value={status as (typeof TASK_STATUSES)[number][]} onChange={(v) => { setStatus(v); setPage(1); }} />
        <ChipFilter label="Engine" options={TASK_ENGINES} value={engine as (typeof TASK_ENGINES)[number][]} onChange={(v) => { setEngine(v); setPage(1); }} />
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : !data?.items.length ? (
        <EmptyState title={live ? 'Waiting for the first results…' : 'No results match'} description={live ? 'Results appear here as tasks complete.' : undefined} />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <SortTh col="id">#</SortTh>
                <Th>URL</Th>
                <Th>Profile</Th>
                <Th>Engine</Th>
                <Th>Status</Th>
                <SortTh col="status">HTTP</SortTh>
                <SortTh col="redirects" className="text-right">Hops</SortTh>
                <SortTh col="time" className="text-right">Time</SortTh>
                <Th>Final URL</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.items.map((t) => (
                <tr key={t.id} onClick={() => onOpen(t.id)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <Td className="text-xs text-slate-400 tabular">{t.id}</Td>
                  <Td className="max-w-64"><Mono className="block truncate">{shortUrl(t.url, 60)}</Mono></Td>
                  <Td className="max-w-56 truncate text-xs">{t.profileName ?? '–'}</Td>
                  <Td><Badge tone={t.engine === 'browser' ? 'violet' : 'blue'}>{t.engine}</Badge></Td>
                  <Td>
                    <TaskStatusBadge status={t.status} />
                    {t.errorCode && t.errorCode !== 'HTTP_ERROR' && <div className="mt-0.5 font-mono text-[10px] text-rose-500">{t.errorCode}</div>}
                  </Td>
                  <Td><HttpStatus code={t.finalStatus} /></Td>
                  <Td className="text-right tabular">{t.redirectCount ?? '–'}</Td>
                  <Td className="text-right text-xs whitespace-nowrap tabular">{fmtMs(t.totalTimeMs)}</Td>
                  <Td className="max-w-64"><Mono className="block truncate text-slate-500">{shortUrl(t.finalUrl, 60)}</Mono></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function SummaryTab({ runId, live, onOpen }: { runId: number; live: boolean; onOpen: (id: number) => void }) {
  const { data: s, isLoading } = useRunSummary(runId, live);
  if (isLoading || !s) return <LoadingBlock />;
  const pie = Object.entries(s.byStatus).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card>
        <CardHeader title="Outcomes" />
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none">
                {pie.map((p) => <Cell key={p.name} fill={STATUS_COLORS[p.name] ?? '#94a3b8'} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="grid grid-cols-2 gap-2 px-5 pb-5 text-xs">
          {pie.map((p) => (
            <li key={p.name} className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm" style={{ background: STATUS_COLORS[p.name] }} />
              <span className="capitalize">{p.name}</span>
              <span className="ml-auto tabular text-slate-500">{fmtNum(p.value)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Timing and redirects" />
        <div className="grid grid-cols-3 gap-4 p-5">
          <div><div className="text-xs text-slate-500">Average time</div><div className="mt-1 text-xl font-semibold tabular">{fmtMs(s.avgTimeMs)}</div></div>
          <div><div className="text-xs text-slate-500">p95 time</div><div className="mt-1 text-xl font-semibold tabular">{fmtMs(s.p95TimeMs)}</div></div>
          <div><div className="text-xs text-slate-500">Average redirects</div><div className="mt-1 text-xl font-semibold tabular">{s.avgRedirects ?? '–'}</div></div>
        </div>
        <div className="grid gap-4 border-t border-slate-200 p-5 sm:grid-cols-2 dark:border-slate-800">
          <div>
            <div className="mb-2 text-xs font-semibold text-slate-500 uppercase">By form factor</div>
            <Table>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {s.byFormFactor.map((f) => (
                  <tr key={f.formFactor}>
                    <Td className="px-0 capitalize">{f.formFactor}</Td>
                    <Td className="text-right tabular">{fmtPct(f.count ? f.success / f.count : null)}</Td>
                    <Td className="pr-0 text-right text-xs text-slate-500 tabular">{f.avgRedirects ?? '–'} hops</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-slate-500 uppercase">By engine</div>
            <Table>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {s.byEngine.map((e) => (
                  <tr key={e.engine}>
                    <Td className="px-0">{e.engine}</Td>
                    <Td className="text-right tabular">{fmtPct(e.count ? e.success / e.count : null)}</Td>
                    <Td className="pr-0 text-right text-xs text-slate-500 tabular">{fmtMs(e.avgTimeMs)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Errors" />
        {s.byErrorCode.length === 0 ? (
          <EmptyState title="No errors" />
        ) : (
          <ul className="divide-y divide-slate-100 px-5 dark:divide-slate-800">
            {s.byErrorCode.map((e) => (
              <li key={e.code} className="flex justify-between py-2 text-sm">
                <span className="font-mono text-xs">{e.code}</span>
                <span className="tabular text-slate-500">{fmtNum(e.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Final destinations" description="Hosts where chains ended" />
        <ul className="divide-y divide-slate-100 px-5 dark:divide-slate-800">
          {s.topFinalDomains.map((d) => (
            <li key={d.domain} className="flex justify-between gap-3 py-2 text-sm">
              <span className="truncate font-mono text-xs">{d.domain}</span>
              <span className="tabular text-slate-500">{fmtNum(d.count)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Slowest" />
        <ul className="divide-y divide-slate-100 px-5 dark:divide-slate-800">
          {s.slowest.map((t) => (
            <li key={t.taskId}>
              <button className="flex w-full justify-between gap-3 py-2 text-left text-sm hover:text-indigo-600" onClick={() => onOpen(t.taskId)}>
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs">{shortUrl(t.url, 50)}</span>
                  <span className="block truncate text-[11px] text-slate-500">{t.profileName}</span>
                </span>
                <span className="shrink-0 tabular text-slate-500">{fmtMs(t.totalTimeMs)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ExportTab({ runId }: { runId: number }) {
  const formats = [
    { f: 'csv', icon: FileSpreadsheet, title: 'CSV spreadsheet', desc: 'One row per task with the full redirect chain. Opens directly in Excel.' },
    { f: 'json', icon: FileJson, title: 'JSON', desc: 'Complete data including every hop, cookies, layout and warnings.' },
    { f: 'html', icon: FileText, title: 'HTML report', desc: 'Self-contained, shareable report with summary and redirect chains.' },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {formats.map(({ f, icon: Icon, title, desc }) => (
        <Card key={f} className="flex flex-col p-5">
          <Icon className="size-6 text-indigo-500" />
          <div className="mt-3 text-sm font-semibold">{title}</div>
          <p className="mt-1 flex-1 text-sm text-slate-500">{desc}</p>
          <a href={`/api/runs/${runId}/export?format=${f}`} download className="mt-4">
            <Button variant="subtle" className="w-full" icon={<Download className="size-4" />}>Download .{f}</Button>
          </a>
        </Card>
      ))}
    </div>
  );
}

function HopTimeline({ hops }: { hops: RedirectHop[] }) {
  return (
    <ol className="relative ml-2 border-l border-slate-200 dark:border-slate-700">
      {hops.map((h, i) => (
        <li key={h.seq} className="mb-4 ml-5 last:mb-0">
          <span
            className={cx(
              'absolute -left-[7px] mt-1 size-3.5 rounded-full border-2 border-white dark:border-slate-900',
              h.error ? 'bg-rose-500' : i === hops.length - 1 ? 'bg-emerald-500' : 'bg-sky-500',
            )}
          />
          <div className="flex flex-wrap items-center gap-2">
            <HttpStatus code={h.statusCode} />
            <Badge tone={HOP_TONE[h.hopType] ?? 'gray'}>{h.hopType === 'js' ? 'JavaScript' : h.hopType === 'meta' ? 'meta refresh' : h.hopType}</Badge>
            <span className="text-xs text-slate-500 tabular">{h.method}{h.responseTimeMs !== null && ` · ${fmtMs(h.responseTimeMs)}`}{h.remoteAddress && ` · ${h.remoteAddress}`}</span>
          </div>
          <Mono className="mt-1 block text-slate-800 dark:text-slate-200">{h.url}</Mono>
          {h.error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{h.error}</p>}
          {h.headers && Object.keys(h.headers).length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-slate-500">Headers</summary>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                {Object.entries(h.headers).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-slate-500">{k}</dt>
                    <dd className="font-mono break-all text-slate-700 dark:text-slate-300">{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{icon}{title}</h3>
      {children}
    </section>
  );
}

function TaskDrawer({ taskId, onClose }: { taskId: number | null; onClose: () => void }) {
  const { data: t, isLoading } = useTask(taskId);
  return (
    <Drawer
      open={taskId !== null}
      onClose={onClose}
      title={t ? <span className="flex items-center gap-2">Task #{t.id} <TaskStatusBadge status={t.status} /></span> : 'Task'}
      actions={t?.finalUrl ? <a href={t.finalUrl} target="_blank" rel="noreferrer noopener"><Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />}>Open final URL</Button></a> : null}
    >
      {isLoading || !t ? <LoadingBlock /> : <TaskBody t={t} />}
    </Drawer>
  );
}

function TaskBody({ t }: { t: TaskDetail }) {
  const r = t.result ?? {};
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-slate-500">Final status</dt><dd className="mt-0.5"><HttpStatus code={t.finalStatus} /></dd></div>
        <div><dt className="text-xs text-slate-500">Redirects</dt><dd className="mt-0.5 tabular">{t.redirectCount ?? '–'}</dd></div>
        <div><dt className="text-xs text-slate-500">Total time</dt><dd className="mt-0.5 tabular">{fmtMs(t.totalTimeMs)}</dd></div>
        <div><dt className="text-xs text-slate-500">Engine</dt><dd className="mt-0.5">{t.engine} · attempt {t.attempts}</dd></div>
      </dl>
      {t.errorCode && (
        <Notice tone="warn" className="mt-4">
          <span className="font-mono text-xs font-semibold">{t.errorCode}</span> {t.errorMessage}
        </Notice>
      )}
      {!!r.warnings?.length && (
        <Section title="Warnings" icon={<TriangleAlert className="size-3.5" />}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-300">
            {r.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Section>
      )}
      <Section title="Redirect chain">
        {t.hops.length ? <HopTimeline hops={t.hops} /> : <p className="text-sm text-slate-500">No hops recorded.</p>}
      </Section>
      <Section title="Landing page">
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Title</dt><dd className="break-words">{r.title ?? '–'}</dd></div>
          <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Final URL</dt><dd><Mono>{t.finalUrl ?? '–'}</Mono></dd></div>
          <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Type</dt><dd>{r.contentType ?? '–'}</dd></div>
          {r.timings && (
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Timings</dt><dd className="tabular">TTFB {fmtMs(r.timings.firstByteMs)} · DOM {fmtMs(r.timings.domContentLoadedMs)} · load {fmtMs(r.timings.loadMs)}</dd></div>
          )}
          {r.jsRedirectSuspected && <div className="text-amber-600">JavaScript redirect suspected: run in browser mode to follow it.</div>}
        </dl>
      </Section>
      {r.layout && (
        <Section title="Layout" icon={<LayoutTemplate className="size-3.5" />}>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><div className="text-xs text-slate-500">Viewport</div><div className="tabular">{r.layout.viewportWidth}×{r.layout.viewportHeight}</div></div>
            <div><div className="text-xs text-slate-500">Document</div><div className="tabular">{r.layout.documentWidth}×{r.layout.documentHeight}</div></div>
            <div><div className="text-xs text-slate-500">Horizontal overflow</div><div>{r.layout.horizontalOverflow ? <Badge tone="amber">yes</Badge> : <Badge tone="green">no</Badge>}</div></div>
            <div><div className="text-xs text-slate-500">Viewport meta</div><div className="break-all">{r.layout.viewportMeta ?? <Badge tone="amber">missing</Badge>}</div></div>
            <div><div className="text-xs text-slate-500">Mobile host</div><div>{r.layout.mobileHost ? 'yes' : 'no'}</div></div>
            <div><div className="text-xs text-slate-500">Small text</div><div>{fmtPct(r.layout.smallTextRatio, 0)}</div></div>
          </div>
        </Section>
      )}
      {r.screenshot && (
        <Section title="Screenshot" icon={<ImageIcon className="size-3.5" />}>
          <a href={`/api/artifacts/${r.screenshot}`} target="_blank" rel="noreferrer">
            <img src={`/api/artifacts/${r.screenshot}`} alt="Final page screenshot" className="max-h-[480px] rounded-lg border border-slate-200 dark:border-slate-700" loading="lazy" />
          </a>
        </Section>
      )}
      {!!r.cookies?.length && (
        <Section title={`Cookies (${r.cookies.length})`} icon={<Cookie className="size-3.5" />}>
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <Table>
              <thead className="bg-slate-50 dark:bg-slate-900/60"><tr><Th>Name</Th><Th>Domain</Th><Th>Flags</Th><Th>Expires</Th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {r.cookies.map((c, i) => (
                  <tr key={i}>
                    <Td><Mono>{c.name}</Mono>{c.value !== undefined && <div className="truncate font-mono text-[10px] text-slate-500">{c.value}</div>}</Td>
                    <Td className="text-xs">{c.domain}</Td>
                    <Td className="space-x-1">{c.secure && <Badge>Secure</Badge>}{c.httpOnly && <Badge>HttpOnly</Badge>}{c.sameSite && <Badge>{c.sameSite}</Badge>}</Td>
                    <Td className="text-xs whitespace-nowrap">{c.expires ? fmtDate(c.expires) : 'session'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Section>
      )}
      {!!r.consoleErrors?.length && (
        <Section title={`Console errors (${r.consoleErrors.length})`}>
          <ul className="space-y-1">{r.consoleErrors.map((e, i) => <li key={i}><Mono className="text-rose-600 dark:text-rose-400">{e}</Mono></li>)}</ul>
        </Section>
      )}
      {t.profile && (
        <Section title="Device profile">
          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900/60">
            <div className="font-medium">{t.profile.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {PLATFORM_LABEL[t.profile.platform]} {t.profile.osVersion} · {FORM_LABEL[t.profile.formFactor]} · {BROWSER_LABEL[t.profile.browser]} {t.profile.browserVersion} · {t.profile.viewportWidth}×{t.profile.viewportHeight} @{t.profile.deviceScaleFactor}x · {t.profile.locale} · {t.profile.timezone}
            </div>
            <Mono className="mt-2 block text-slate-600 dark:text-slate-400">{t.profile.userAgent}</Mono>
          </div>
        </Section>
      )}
    </>
  );
}
