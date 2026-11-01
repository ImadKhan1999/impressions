import { Activity, CheckCircle2, Globe, ListChecks, Plus, Smartphone } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useActive, useRuns, useStats } from '../api/hooks';
import { RunProgressBar, successRate } from '../components/RunBits';
import { Button, Card, CardHeader, EmptyState, LoadingBlock, PageHeader, RunStatusBadge, Stat, Table, Td, Th } from '../components/ui';
import { MODE_LABEL, fmtNum, fmtPct, fmtRelative } from '../lib/format';

export function Dashboard() {
  const { data: stats, isLoading } = useStats();
  const { data: active = [] } = useActive();
  const { data: recent } = useRuns({ page: 1, pageSize: 8 });
  const navigate = useNavigate();
  const activeIds = new Set(active.map((a) => a.runId));
  const activeRuns = recent?.items.filter((r) => activeIds.has(r.id) || r.status === 'running' || r.status === 'queued') ?? [];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Redirect behaviour and device compatibility across your URL lists."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/runs/new')}>
            New test run
          </Button>
        }
      />
      {isLoading || !stats ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="URLs" value={fmtNum(stats.urls)} sub={`${fmtNum(stats.urlLists)} lists`} icon={<Globe className="size-4" />} />
            <Stat
              label="Device profiles"
              value={fmtNum(stats.profiles)}
              sub={`${fmtNum(stats.enabledProfiles)} enabled`}
              icon={<Smartphone className="size-4" />}
            />
            <Stat
              label="Test runs"
              value={fmtNum(stats.runs)}
              sub={stats.activeRuns ? `${stats.activeRuns} active now` : 'none active'}
              icon={<ListChecks className="size-4" />}
              accent={stats.activeRuns ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' : undefined}
            />
            <Stat
              label="Success rate (7 days)"
              value={fmtPct(stats.successRateLast7Days)}
              sub={`${fmtNum(stats.tasksLast7Days)} checks`}
              icon={<CheckCircle2 className="size-4" />}
              accent="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
            />
          </div>

          {activeRuns.length > 0 && (
            <Card className="mt-6">
              <CardHeader title={<span className="inline-flex items-center gap-2"><Activity className="size-4 text-indigo-500" /> Active runs</span>} />
              <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                {activeRuns.map((r) => (
                  <li key={r.id}>
                    <Link to={`/runs/${r.id}`} className="flex flex-wrap items-center gap-4 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{r.name}</div>
                        <div className="text-xs text-slate-500">
                          {MODE_LABEL[r.mode]} · {fmtNum(r.profileCount)} profiles · {r.urlListName ?? 'deleted list'}
                        </div>
                      </div>
                      <div className="w-full sm:w-72">
                        <RunProgressBar run={r} progress={active.find((a) => a.runId === r.id)} />
                      </div>
                      <RunStatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Checks per day" description="Completed tasks by outcome over the last 7 days" />
              <div className="h-64 px-2 py-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.daily.map((d) => ({ ...d, label: new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }) }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="currentColor" className="text-slate-500" />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={40} stroke="currentColor" className="text-slate-500" />
                    <Tooltip
                      cursor={{ fill: 'rgba(100,116,139,0.08)' }}
                      contentStyle={{ borderRadius: 8, border: '1px solid rgb(226 232 240)', fontSize: 12 }}
                    />
                    <Bar dataKey="success" name="Success" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="failed" name="HTTP 4xx/5xx" stackId="a" fill="#f59e0b" />
                    <Bar dataKey="error" name="Errors" stackId="a" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="Top errors" description="Last 7 days" />
              {stats.topErrors.length === 0 ? (
                <EmptyState title="No errors" description="Nothing failed in the last week." />
              ) : (
                <ul className="space-y-3 px-5 py-4">
                  {stats.topErrors.map((e) => {
                    const max = stats.topErrors[0]!.count;
                    return (
                      <li key={e.code}>
                        <div className="flex justify-between text-xs">
                          <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{e.code}</span>
                          <span className="tabular text-slate-500">{fmtNum(e.count)}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className="h-full rounded-full bg-rose-500" style={{ width: `${(e.count / max) * 100}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader title="Recent runs" actions={<Link className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" to="/runs">View all</Link>} />
            {!recent?.items.length ? (
              <EmptyState
                icon={<ListChecks className="size-5" />}
                title="No test runs yet"
                description="Import a URL list, pick device profiles, and start your first run."
                action={<Button variant="primary" onClick={() => navigate('/runs/new')}>Create a run</Button>}
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Status</Th>
                    <Th>Progress</Th>
                    <Th className="text-right">Success</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {recent.items.map((r) => (
                    <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => navigate(`/runs/${r.id}`)}>
                      <Td className="font-medium text-slate-900 dark:text-white">{r.name}</Td>
                      <Td><RunStatusBadge status={r.status} /></Td>
                      <Td className="w-56"><RunProgressBar run={r} compact /></Td>
                      <Td className="text-right tabular">{fmtPct(successRate(r))}</Td>
                      <Td className="text-xs text-slate-500">{fmtRelative(r.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}
