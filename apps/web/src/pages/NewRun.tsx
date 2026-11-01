import { ArrowLeft, ArrowRight, Check, Globe, Network, Play, Rocket, Save, Smartphone, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LIMITS, WAIT_UNTIL, type ProfileFilter, type RunMode, type RunSettingsInput } from '@impressions/shared';
import { useCreateRun, useFacets, useProfiles, useProxies, useSettings, useUrlLists } from '../api/hooks';
import { ProfileFilters } from '../components/ProfileFilters';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Notice,
  PageHeader,
  Pagination,
  Segmented,
  Select,
  Table,
  Td,
  Th,
  Toggle,
  cx,
  useDebounced,
  useToast,
} from '../components/ui';
import { BROWSER_LABEL, FORM_LABEL, MODE_LABEL, PLATFORM_LABEL, fmtDuration, fmtNum } from '../lib/format';

const STEPS = [
  { key: 'urls', label: 'URLs', icon: Globe },
  { key: 'profiles', label: 'Device profiles', icon: Smartphone },
  { key: 'network', label: 'Network', icon: Network },
  { key: 'engine', label: 'Engine & limits', icon: SlidersHorizontal },
  { key: 'review', label: 'Review', icon: Rocket },
] as const;

type Settings = Required<Pick<RunSettingsInput, 'concurrency' | 'browserConcurrency' | 'requestsPerSecondPerDomain' | 'maxConcurrentPerDomain' | 'timeoutMs' | 'maxRedirects' | 'retries'>> & {
  browser: { waitUntil: (typeof WAIT_UNTIL)[number]; settleMs: number; screenshot: boolean; captureCookieValues: boolean };
  http: { followMetaRefresh: boolean; method: 'GET' | 'HEAD' };
};

function NumberField({
  label,
  value,
  onChange,
  limit,
  step = 1,
  hint,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  limit: { min: number; max: number };
  step?: number;
  hint?: string;
  suffix?: string;
}) {
  return (
    <Field label={label} hint={hint ?? `Between ${limit.min} and ${limit.max}${suffix ? ` ${suffix}` : ''}`}>
      {(id) => (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={limit.min}
            max={limit.max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-indigo-600"
          />
          <Input
            id={id}
            type="number"
            min={limit.min}
            max={limit.max}
            step={step}
            value={value}
            onChange={(e) => onChange(Math.min(limit.max, Math.max(limit.min, Number(e.target.value) || limit.min)))}
            className="w-24 tabular"
          />
        </div>
      )}
    </Field>
  );
}

export function NewRun() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { data: lists = [] } = useUrlLists();
  const { data: proxies = [] } = useProxies();
  const { data: appSettings } = useSettings();
  const create = useCreateRun();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(`Run ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`);
  const [listId, setListId] = useState<number | null>(params.get('list') ? Number(params.get('list')) : null);
  const [mode, setMode] = useState<RunMode>('browser');
  const [proxyId, setProxyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<ProfileFilter>({ enabled: true });
  const [pickMode, setPickMode] = useState<'filter' | 'pick'>('filter');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [ppage, setPpage] = useState(1);
  const debounced = useDebounced(filter);
  const { data: facets } = useFacets(debounced);
  const { data: profilePage } = useProfiles({ ...debounced, page: ppage, pageSize: 12, sort: 'platform' });

  const defaults = appSettings?.defaultRunSettings;
  const [settings, setSettings] = useState<Settings | null>(null);
  const s: Settings =
    settings ??
    ({
      concurrency: defaults?.concurrency ?? LIMITS.concurrency.default,
      browserConcurrency: defaults?.browserConcurrency ?? LIMITS.browserConcurrency.default,
      requestsPerSecondPerDomain: defaults?.requestsPerSecondPerDomain ?? LIMITS.requestsPerSecondPerDomain.default,
      maxConcurrentPerDomain: defaults?.maxConcurrentPerDomain ?? LIMITS.maxConcurrentPerDomain.default,
      timeoutMs: defaults?.timeoutMs ?? LIMITS.timeoutMs.default,
      maxRedirects: defaults?.maxRedirects ?? LIMITS.maxRedirects.default,
      retries: defaults?.retries ?? LIMITS.retries.default,
      browser: {
        waitUntil: defaults?.browser.waitUntil ?? 'load',
        settleMs: defaults?.browser.settleMs ?? LIMITS.settleMs.default,
        screenshot: defaults?.browser.screenshot ?? false,
        captureCookieValues: defaults?.browser.captureCookieValues ?? false,
      },
      http: { followMetaRefresh: defaults?.http.followMetaRefresh ?? true, method: defaults?.http.method ?? 'GET' },
    } as Settings);
  const set = (patch: Partial<Settings>) => setSettings({ ...s, ...patch });

  const list = lists.find((l) => l.id === listId) ?? null;
  const proxy = proxies.find((p) => p.id === proxyId) ?? null;
  const profileCount = pickMode === 'pick' ? picked.size : (facets?.total ?? 0);
  const engines = mode === 'both' ? 2 : 1;
  const taskCount = (list?.urlCount ?? 0) * profileCount * engines;
  const domains = list?.domainCount ?? 0;
  // Lower bound: tasks are spread across domains, each domain limited to N starts per second.
  const minSeconds = domains ? taskCount / Math.min(domains * s.requestsPerSecondPerDomain, Infinity) : 0;

  const stepValid = useMemo(
    () => [
      !!list && list.urlCount > 0 && name.trim().length > 0,
      profileCount > 0 && profileCount <= LIMITS.maxProfilesPerRun,
      true,
      true,
      taskCount > 0 && taskCount <= LIMITS.maxTasksPerRun,
    ],
    [list, name, profileCount, taskCount],
  );

  async function submit(start: boolean) {
    if (!list) return;
    try {
      const run = await create.mutateAsync({
        name: name.trim(),
        mode,
        urlListId: list.id,
        proxyId,
        profiles: pickMode === 'pick' ? { ids: [...picked] } : { filter: { ...filter, q: filter.q?.trim() || undefined } },
        settings: s,
        start,
      });
      toast.success(start ? 'Run started' : 'Run saved as draft', `${fmtNum(run.totalTasks)} tasks planned`);
      navigate(`/runs/${run.id}`);
    } catch (e) {
      toast.error('Could not create the run', e);
    }
  }

  const togglePick = (id: number) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="New test run"
        description="Test every URL in a list against the device profiles you choose."
        actions={
          <Link to="/runs">
            <Button variant="ghost" icon={<ArrowLeft className="size-4" />}>Back to runs</Button>
          </Link>
        }
      />

      <ol className="mb-6 grid grid-cols-5 gap-2">
        {STEPS.map((st, i) => {
          const Icon = st.icon;
          const reachable = i <= step || stepValid.slice(0, i).every(Boolean);
          return (
            <li key={st.key}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => setStep(i)}
                className={cx(
                  'flex w-full flex-col items-start gap-1 rounded-lg border-t-4 px-1 pt-2 text-left text-xs font-medium transition disabled:opacity-50',
                  i === step ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300' : i < step ? 'border-indigo-300 text-slate-600 dark:border-indigo-800 dark:text-slate-300' : 'border-slate-200 text-slate-400 dark:border-slate-800',
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {i < step ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                  <span className="hidden sm:inline">{st.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <Card className="p-5 sm:p-6">
        {step === 0 && (
          <div className="space-y-5">
            <Field label="Run name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />}</Field>
            <div>
              <div className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">URL list</div>
              {lists.length === 0 ? (
                <EmptyState
                  icon={<Globe className="size-5" />}
                  title="No URL lists yet"
                  description="Create a list and import URLs from a TXT or CSV file first."
                  action={<Link to="/urls"><Button variant="primary">Go to URL lists</Button></Link>}
                />
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {lists.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setListId(l.id)}
                      disabled={l.urlCount === 0}
                      className={cx(
                        'rounded-xl border p-4 text-left transition disabled:opacity-50',
                        l.id === listId
                          ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-500/30 dark:bg-indigo-500/10'
                          : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700',
                      )}
                    >
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{l.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {fmtNum(l.urlCount)} URLs · {fmtNum(l.domainCount)} domains
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                value={pickMode}
                onChange={setPickMode}
                options={[
                  { value: 'filter', label: 'All profiles matching filters' },
                  { value: 'pick', label: 'Pick individual profiles' },
                ]}
              />
              <Badge tone="indigo">{fmtNum(profileCount)} selected</Badge>
            </div>
            <ProfileFilters
              filter={filter}
              onChange={(f) => {
                setFilter({ ...f, enabled: true });
                setPpage(1);
              }}
              facets={facets}
            />
            {profileCount > LIMITS.maxProfilesPerRun && (
              <Notice tone="warn">A run can use at most {fmtNum(LIMITS.maxProfilesPerRun)} profiles. Narrow the filters.</Notice>
            )}
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
              <Table>
                <thead className="bg-slate-50 dark:bg-slate-900/60">
                  <tr>
                    {pickMode === 'pick' && (
                      <Th className="w-8">
                        <Checkbox
                          checked={!!profilePage?.items.length && profilePage.items.every((p) => picked.has(p.id))}
                          indeterminate={profilePage?.items.some((p) => picked.has(p.id))}
                          onChange={(v) =>
                            setPicked((prev) => {
                              const n = new Set(prev);
                              for (const p of profilePage?.items ?? []) {
                                if (v) n.add(p.id);
                                else n.delete(p.id);
                              }
                              return n;
                            })
                          }
                        />
                      </Th>
                    )}
                    <Th>Profile</Th>
                    <Th>Platform</Th>
                    <Th>Browser</Th>
                    <Th>Viewport</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {profilePage?.items.map((p) => (
                    <tr key={p.id} className={cx(pickMode === 'pick' && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40')} onClick={() => pickMode === 'pick' && togglePick(p.id)}>
                      {pickMode === 'pick' && (
                        <Td onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={picked.has(p.id)} onChange={() => togglePick(p.id)} />
                        </Td>
                      )}
                      <Td className="max-w-md truncate font-medium text-slate-900 dark:text-white">{p.name}</Td>
                      <Td className="text-xs">{PLATFORM_LABEL[p.platform]} · {FORM_LABEL[p.formFactor]}</Td>
                      <Td className="text-xs">{BROWSER_LABEL[p.browser]} {p.browserVersion}</Td>
                      <Td className="font-mono text-xs tabular">{p.viewportWidth}×{p.viewportHeight}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {profilePage && <Pagination page={ppage} pageSize={12} total={profilePage.total} onPage={setPpage} />}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <Notice>
              Choose one proxy for this run, or none. The same proxy is used for every request in the run; proxies are never rotated.
            </Notice>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <button
                type="button"
                onClick={() => setProxyId(null)}
                className={cx('rounded-xl border p-4 text-left', proxyId === null ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-slate-200 dark:border-slate-800')}
              >
                <div className="text-sm font-medium">Direct connection</div>
                <div className="mt-1 text-xs text-slate-500">Use this computer's network</div>
              </button>
              {proxies.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProxyId(p.id)}
                  className={cx('rounded-xl border p-4 text-left', proxyId === p.id ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-slate-200 dark:border-slate-800')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    {p.lastCheckOk !== null && <Badge tone={p.lastCheckOk ? 'green' : 'red'}>{p.lastCheckOk ? 'ok' : 'failed'}</Badge>}
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-500">
                    {p.protocol}://{p.host}:{p.port}
                  </div>
                </button>
              ))}
            </div>
            {proxies.length === 0 && (
              <p className="text-sm text-slate-500">
                No proxies configured. <Link to="/proxies" className="text-indigo-600 hover:underline">Add one</Link> if you need to test through a specific network.
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div>
              <div className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">Engine</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    ['http', 'HTTP', 'Fast server-side redirect chains with the profile UA. No JavaScript.'],
                    ['browser', 'Browser', 'Real browser: JavaScript redirects, cookies, layout and screenshots.'],
                    ['both', 'HTTP + Browser', 'Runs both engines per URL and profile to compare behaviour.'],
                  ] as const
                ).map(([value, label, desc]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={cx('rounded-xl border p-4 text-left', mode === value ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-slate-200 dark:border-slate-800')}
                  >
                    <div className="text-sm font-medium">{label}</div>
                    <div className="mt-1 text-xs text-slate-500">{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <NumberField label="Parallel tasks" value={s.concurrency} onChange={(v) => set({ concurrency: v })} limit={LIMITS.concurrency} />
              <NumberField
                label="Parallel browser sessions"
                value={s.browserConcurrency}
                onChange={(v) => set({ browserConcurrency: v })}
                limit={LIMITS.browserConcurrency}
                hint={`Also capped globally at ${appSettings?.maxBrowserSessions ?? 4} by Settings`}
              />
              <NumberField
                label="Requests per second, per domain"
                value={s.requestsPerSecondPerDomain}
                onChange={(v) => set({ requestsPerSecondPerDomain: v })}
                limit={LIMITS.requestsPerSecondPerDomain}
                step={0.1}
                hint={`Always enforced. Max ${LIMITS.requestsPerSecondPerDomain.max}/s per registrable domain.`}
              />
              <NumberField
                label="Concurrent tasks per domain"
                value={s.maxConcurrentPerDomain}
                onChange={(v) => set({ maxConcurrentPerDomain: v })}
                limit={LIMITS.maxConcurrentPerDomain}
              />
              <NumberField label="Timeout per task" value={s.timeoutMs / 1000} onChange={(v) => set({ timeoutMs: v * 1000 })} limit={{ min: 2, max: 180 }} suffix="seconds" />
              <NumberField label="Maximum redirects" value={s.maxRedirects} onChange={(v) => set({ maxRedirects: v })} limit={LIMITS.maxRedirects} />
              <NumberField
                label="Retries on network errors"
                value={s.retries}
                onChange={(v) => set({ retries: v })}
                limit={LIMITS.retries}
                hint="Only timeouts, resets and proxy failures are retried; responses are never re-requested."
              />
            </div>

            {mode !== 'http' && (
              <div className="grid gap-6 rounded-xl bg-slate-50 p-4 md:grid-cols-2 dark:bg-slate-900/60">
                <Field label="Wait until" hint="Page load event to wait for before the settle period">
                  {(id) => (
                    <Select id={id} value={s.browser.waitUntil} onChange={(e) => set({ browser: { ...s.browser, waitUntil: e.target.value as Settings['browser']['waitUntil'] } })}>
                      {WAIT_UNTIL.map((w) => (
                        <option key={w} value={w}>{w}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <NumberField
                  label="Settle period"
                  value={s.browser.settleMs}
                  onChange={(v) => set({ browser: { ...s.browser, settleMs: v } })}
                  limit={LIMITS.settleMs}
                  step={100}
                  hint="Quiet time with no navigation before the page counts as final (catches delayed JS redirects)"
                />
                <Toggle checked={s.browser.screenshot} onChange={(v) => set({ browser: { ...s.browser, screenshot: v } })} label="Capture screenshots" description="Viewport JPEG of the final landing page" />
                <Toggle
                  checked={s.browser.captureCookieValues}
                  onChange={(v) => set({ browser: { ...s.browser, captureCookieValues: v } })}
                  label="Store cookie values"
                  description="Off by default; names, domains and flags are always recorded"
                />
              </div>
            )}
            {mode !== 'browser' && (
              <div className="grid gap-6 rounded-xl bg-slate-50 p-4 md:grid-cols-2 dark:bg-slate-900/60">
                <Field label="HTTP method">
                  {(id) => (
                    <Select id={id} value={s.http.method} onChange={(e) => set({ http: { ...s.http, method: e.target.value as 'GET' | 'HEAD' } })}>
                      <option value="GET">GET (recommended)</option>
                      <option value="HEAD">HEAD</option>
                    </Select>
                  )}
                </Field>
                <Toggle checked={s.http.followMetaRefresh} onChange={(v) => set({ http: { ...s.http, followMetaRefresh: v } })} label="Follow meta refresh" description="Treat <meta http-equiv=refresh> as a redirect" />
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['URL list', list ? `${list.name} (${fmtNum(list.urlCount)} URLs)` : '–'],
                ['Profiles', fmtNum(profileCount)],
                ['Engine', MODE_LABEL[mode]],
                ['Network', proxy ? `${proxy.name} (${proxy.protocol})` : 'Direct'],
                ['Tasks', fmtNum(taskCount)],
                ['Rate limit', `${s.requestsPerSecondPerDomain}/s, ${s.maxConcurrentPerDomain} concurrent per domain`],
                ['Parallelism', `${s.concurrency} tasks, ${s.browserConcurrency} browsers`],
                ['Minimum duration', taskCount ? `≈ ${fmtDuration(minSeconds)}+` : '–'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60">
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="mt-1 text-sm font-medium break-words text-slate-900 dark:text-white">{v}</dd>
                </div>
              ))}
            </dl>
            {taskCount > LIMITS.maxTasksPerRun && <Notice tone="warn">This exceeds the {fmtNum(LIMITS.maxTasksPerRun)} task limit per run.</Notice>}
            <Notice>Each URL is tested once per profile and engine. The browser engine only observes pages; it never clicks or interacts with content.</Notice>
            <ErrorNotice error={create.error} />
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)} icon={<ArrowLeft className="size-4" />}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" disabled={!stepValid[step]} onClick={() => setStep(step + 1)}>
              Next <ArrowRight className="size-4" />
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button icon={<Save className="size-4" />} disabled={!stepValid.every(Boolean)} loading={create.isPending} onClick={() => submit(false)}>
                Save as draft
              </Button>
              <Button variant="primary" icon={<Play className="size-4" />} disabled={!stepValid.every(Boolean)} loading={create.isPending} onClick={() => submit(true)}>
                Start run
              </Button>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
