import { ListChecks, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RUN_STATUSES } from '@impressions/shared';
import { useRuns } from '../api/hooks';
import { RunProgressBar, successRate } from '../components/RunBits';
import { Button, Card, ChipFilter, EmptyState, Input, LoadingBlock, PageHeader, Pagination, RunStatusBadge, Table, Td, Th, useDebounced } from '../components/ui';
import { MODE_LABEL, fmtNum, fmtPct, fmtRelative, runDuration } from '../lib/format';

export function Runs() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<string[]>(params.get('status')?.split(',').filter(Boolean) ?? []);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, isLoading } = useRuns({ page, pageSize: 25, status, q: q || undefined }, true);

  return (
    <>
      <PageHeader
        title="Test runs"
        description="History of every run with live progress. Open a run for results, redirect chains and exports."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/runs/new')}>
            New test run
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Search runs"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <ChipFilter
            label="Status"
            options={RUN_STATUSES}
            value={status as (typeof RUN_STATUSES)[number][]}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          />
        </div>
        {isLoading ? (
          <LoadingBlock />
        ) : !data?.items.length ? (
          <EmptyState
            icon={<ListChecks className="size-5" />}
            title={status.length || q ? 'No runs match these filters' : 'No test runs yet'}
            description="A run tests every URL in a list against the device profiles you choose."
            action={<Button variant="primary" onClick={() => navigate('/runs/new')}>Create a run</Button>}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th>Status</Th>
                  <Th>Mode</Th>
                  <Th className="text-right">Profiles</Th>
                  <Th>Progress</Th>
                  <Th className="text-right">Success</Th>
                  <Th>Duration</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.items.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => navigate(`/runs/${r.id}`)}>
                    <Td>
                      <div className="font-medium text-slate-900 dark:text-white">{r.name}</div>
                      <div className="text-xs text-slate-500">
                        #{r.id} · {r.urlListName ?? 'deleted list'}
                        {r.proxyName ? ` · via ${r.proxyName}` : ''}
                      </div>
                    </Td>
                    <Td><RunStatusBadge status={r.status} /></Td>
                    <Td className="text-xs">{MODE_LABEL[r.mode]}</Td>
                    <Td className="text-right tabular">{fmtNum(r.profileCount)}</Td>
                    <Td className="w-56"><RunProgressBar run={r} /></Td>
                    <Td className="text-right tabular">{fmtPct(successRate(r))}</Td>
                    <Td className="text-xs tabular">{runDuration(r.startedAt, r.finishedAt)}</Td>
                    <Td className="text-xs whitespace-nowrap text-slate-500">{fmtRelative(r.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
