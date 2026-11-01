import type { RunProgress, TestRun } from '@impressions/shared';
import { fmtDuration, fmtNum } from '../lib/format';
import { ProgressBar } from './ui';

/** Stacked success / failed / remaining bar with counts. */
export function RunProgressBar({ run, progress, compact }: { run: TestRun; progress?: RunProgress | null; compact?: boolean }) {
  const total = progress?.totalTasks ?? run.totalTasks;
  const success = progress?.successTasks ?? run.successTasks;
  const failed = progress?.failedTasks ?? run.failedTasks;
  const done = progress?.doneTasks ?? run.doneTasks;
  const pct = total ? Math.floor((done / total) * 100) : 0;
  return (
    <div className="min-w-40">
      <ProgressBar
        max={total}
        segments={[
          { value: success, className: 'bg-emerald-500' },
          { value: failed, className: 'bg-rose-500' },
          { value: Math.max(0, done - success - failed), className: 'bg-slate-400' },
        ]}
      />
      {!compact && (
        <div className="mt-1 flex justify-between text-[11px] text-slate-500 tabular dark:text-slate-400">
          <span>
            {fmtNum(done)} / {fmtNum(total)} · {pct}%
          </span>
          {progress && progress.status === 'running' && (
            <span>
              {progress.throughputPerMin ? `${progress.throughputPerMin}/min` : 'starting…'}
              {progress.etaSeconds !== null && ` · ETA ${fmtDuration(progress.etaSeconds)}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function successRate(run: Pick<TestRun, 'doneTasks' | 'successTasks'>): number | null {
  return run.doneTasks ? run.successTasks / run.doneTasks : null;
}
