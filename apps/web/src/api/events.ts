import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RunProgress, ServerEvent, TestRun } from '@impressions/shared';
import { keys } from './hooks';

const EVENT_TYPES: ServerEvent['type'][] = [
  'run.updated',
  'run.progress',
  'run.deleted',
  'task.completed',
  'profiles.changed',
  'urls.changed',
  'proxies.changed',
];

/**
 * Subscribes to the server's SSE stream and keeps the query cache fresh.
 * EventSource reconnects automatically; `connected` reflects the live state.
 */
export function useServerEvents(runId?: number, onEvent?: (e: ServerEvent) => void): { connected: boolean } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const es = new EventSource(`/api/events${runId ? `?runId=${runId}` : ''}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const listener = (msg: MessageEvent<string>) => {
      let e: ServerEvent;
      try {
        e = JSON.parse(msg.data) as ServerEvent;
      } catch {
        return;
      }
      switch (e.type) {
        case 'run.progress':
          qc.setQueryData<RunProgress[]>(keys.active, (prev = []) => {
            const rest = prev.filter((p) => p.runId !== e.progress.runId);
            return e.progress.status === 'running' ? [...rest, e.progress] : rest;
          });
          qc.setQueryData<{ run: TestRun; progress: RunProgress | null }>(keys.run(e.progress.runId), (prev) =>
            prev
              ? {
                  run: {
                    ...prev.run,
                    doneTasks: e.progress.doneTasks,
                    successTasks: e.progress.successTasks,
                    failedTasks: e.progress.failedTasks,
                    totalTasks: e.progress.totalTasks,
                  },
                  progress: e.progress,
                }
              : prev,
          );
          break;
        case 'run.updated':
          qc.setQueryData<{ run: TestRun; progress: RunProgress | null }>(keys.run(e.run.id), (prev) =>
            prev ? { ...prev, run: e.run, progress: e.run.status === 'running' ? prev.progress : null } : prev,
          );
          void qc.invalidateQueries({ queryKey: ['runs'] });
          void qc.invalidateQueries({ queryKey: keys.stats });
          if (e.run.status !== 'running') {
            qc.setQueryData<RunProgress[]>(keys.active, (prev = []) => prev.filter((p) => p.runId !== e.run.id));
            void qc.invalidateQueries({ queryKey: keys.summary(e.run.id) });
            void qc.invalidateQueries({ queryKey: ['run', e.run.id, 'tasks'] });
          }
          break;
        case 'run.deleted':
          void qc.invalidateQueries({ queryKey: ['runs'] });
          break;
        case 'profiles.changed':
          void qc.invalidateQueries({ queryKey: ['profiles'] });
          break;
        case 'urls.changed':
          void qc.invalidateQueries({ queryKey: ['url-lists'] });
          break;
        case 'proxies.changed':
          void qc.invalidateQueries({ queryKey: keys.proxies });
          break;
        default:
          break;
      }
      handler.current?.(e);
    };
    for (const t of EVENT_TYPES) es.addEventListener(t, listener as EventListener);
    return () => es.close();
  }, [qc, runId]);

  return { connected };
}
