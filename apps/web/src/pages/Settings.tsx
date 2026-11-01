import { CheckCircle2, Save, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LIMITS, type AppSettings } from '@impressions/shared';
import { useSaveSettings, useSettings, useSystem } from '../api/hooks';
import { Button, Card, CardHeader, ErrorNotice, Field, Input, LoadingBlock, Mono, PageHeader, Select, Toggle, useToast } from '../components/ui';
import { ENGINE_LABEL, fmtBytes } from '../lib/format';

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const { data: system } = useSystem();
  const save = useSaveSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  useEffect(() => {
    if (settings && !draft) setDraft(settings);
  }, [settings, draft]);

  if (isLoading || !draft) return <LoadingBlock />;
  const d = draft;
  const set = (p: Partial<AppSettings>) => setDraft({ ...d, ...p });
  const setRun = (p: Partial<AppSettings['defaultRunSettings']>) => set({ defaultRunSettings: { ...d.defaultRunSettings, ...p } });
  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Number(v) || min));

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <Button
            variant="primary"
            icon={<Save className="size-4" />}
            loading={save.isPending}
            onClick={async () => {
              try {
                const s = await save.mutateAsync(d);
                setDraft(s);
                toast.success('Settings saved');
              } catch (e) {
                toast.error('Could not save settings', e);
              }
            }}
          >
            Save settings
          </Button>
        }
      />
      <ErrorNotice error={save.error} className="mb-4" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Browser sessions" description="Live browser resources are separate from the profile library and bounded here." />
          <div className="space-y-5 p-5">
            <Field label="Maximum open browser sessions (all runs)" hint={`1–${LIMITS.browserConcurrency.max}. Each session is one isolated browser context.`}>
              {(id) => <Input id={id} type="number" value={d.maxBrowserSessions} onChange={(e) => set({ maxBrowserSessions: num(e.target.value, 1, LIMITS.browserConcurrency.max) })} />}
            </Field>
            <Field label="Concurrent runs" hint="Additional runs wait in the queue">
              {(id) => <Input id={id} type="number" value={d.maxConcurrentRuns} onChange={(e) => set({ maxConcurrentRuns: num(e.target.value, 1, 8) })} />}
            </Field>
            <Field label="Close idle browsers after (seconds)">
              {(id) => <Input id={id} type="number" value={d.browserIdleSeconds} onChange={(e) => set({ browserIdleSeconds: num(e.target.value, 5, 3600) })} />}
            </Field>
            <Field label="Engine strategy" hint="Native uses WebKit for Safari/iOS and Firefox for Firefox profiles. Chromium-only emulates every profile in Chromium.">
              {(id) => (
                <Select id={id} value={d.engineStrategy} onChange={(e) => set({ engineStrategy: e.target.value as AppSettings['engineStrategy'] })}>
                  <option value="native">Native engines (recommended)</option>
                  <option value="chromium-only">Chromium only</option>
                </Select>
              )}
            </Field>
            <Toggle checked={d.headless} onChange={(v) => set({ headless: v })} label="Headless browsers" description="Turn off to watch browser windows while debugging" />
          </div>
        </Card>

        <Card>
          <CardHeader title="Default run settings" description="Pre-filled in the new run wizard" />
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <Field label="Parallel tasks">{(id) => <Input id={id} type="number" value={d.defaultRunSettings.concurrency} onChange={(e) => setRun({ concurrency: num(e.target.value, 1, LIMITS.concurrency.max) })} />}</Field>
            <Field label="Parallel browsers">{(id) => <Input id={id} type="number" value={d.defaultRunSettings.browserConcurrency} onChange={(e) => setRun({ browserConcurrency: num(e.target.value, 1, LIMITS.browserConcurrency.max) })} />}</Field>
            <Field label="Requests / second / domain" hint={`Max ${LIMITS.requestsPerSecondPerDomain.max}`}>
              {(id) => <Input id={id} type="number" step={0.1} value={d.defaultRunSettings.requestsPerSecondPerDomain} onChange={(e) => setRun({ requestsPerSecondPerDomain: Math.min(LIMITS.requestsPerSecondPerDomain.max, Math.max(LIMITS.requestsPerSecondPerDomain.min, Number(e.target.value) || 1)) })} />}
            </Field>
            <Field label="Concurrent per domain" hint={`Max ${LIMITS.maxConcurrentPerDomain.max}`}>
              {(id) => <Input id={id} type="number" value={d.defaultRunSettings.maxConcurrentPerDomain} onChange={(e) => setRun({ maxConcurrentPerDomain: num(e.target.value, 1, LIMITS.maxConcurrentPerDomain.max) })} />}
            </Field>
            <Field label="Timeout (seconds)">{(id) => <Input id={id} type="number" value={d.defaultRunSettings.timeoutMs / 1000} onChange={(e) => setRun({ timeoutMs: num(e.target.value, 2, 180) * 1000 })} />}</Field>
            <Field label="Max redirects">{(id) => <Input id={id} type="number" value={d.defaultRunSettings.maxRedirects} onChange={(e) => setRun({ maxRedirects: num(e.target.value, 0, LIMITS.maxRedirects.max) })} />}</Field>
            <Field label="Retention (days)" hint="Delete finished runs older than this. 0 keeps everything." className="sm:col-span-2">
              {(id) => <Input id={id} type="number" value={d.retentionDays} onChange={(e) => set({ retentionDays: num(e.target.value, 0, 3650) })} />}
            </Field>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="System" />
          {!system ? (
            <LoadingBlock />
          ) : (
            <div className="grid gap-6 p-5 md:grid-cols-2">
              <dl className="space-y-2 text-sm">
                {[
                  ['Version', system.version],
                  ['Node.js', system.node],
                  ['Platform', system.platform],
                  ['Database size', fmtBytes(system.dbSizeBytes)],
                  ['Open browser sessions', `${system.browserSessions.open} / ${system.browserSessions.max}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <dt className="w-44 shrink-0 text-slate-500">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
                <div className="flex gap-3">
                  <dt className="w-44 shrink-0 text-slate-500">Data folder</dt>
                  <dd><Mono>{system.dataDir}</Mono></dd>
                </div>
              </dl>
              <div>
                <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Browser engines</div>
                <ul className="space-y-2">
                  {system.browsers.map((b) => (
                    <li key={b.engine} className="flex items-center gap-2 text-sm">
                      {b.installed ? <CheckCircle2 className="size-4 text-emerald-500" /> : <XCircle className="size-4 text-slate-400" />}
                      <span className="w-20 font-medium">{ENGINE_LABEL[b.engine]}</span>
                      <span className="text-xs text-slate-500">{b.installed ? 'installed' : 'not installed'}</span>
                    </li>
                  ))}
                </ul>
                {system.browsers.some((b) => !b.installed) && (
                  <p className="mt-3 text-xs text-slate-500">
                    Install missing engines by running <Mono className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">{system.installCommand}</Mono> in the project folder, or switch to the Chromium-only strategy.
                  </p>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
