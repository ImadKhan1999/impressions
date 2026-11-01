import { Download, MoreHorizontal, Pencil, Plus, Smartphone, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BROWSERS,
  FORM_FACTORS,
  PLATFORMS,
  type BrowserFamily,
  type DeviceProfile,
  type GenerateResult,
  type Platform,
  type ProfileFilter,
  type ProfileInput,
} from '@impressions/shared';
import { api } from '../api/client';
import { useBulkProfiles, useCatalog, useDeleteProfile, useFacets, useGenerateProfiles, useImportProfiles, useProfiles, useSaveProfile } from '../api/hooks';
import { ProfileFilters } from '../components/ProfileFilters';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ChipFilter,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Pagination,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  Toggle,
  cx,
  useDebounced,
  useToast,
} from '../components/ui';
import { BROWSER_LABEL, ENGINE_LABEL, FORM_LABEL, PLATFORM_LABEL, fmtNum } from '../lib/format';

const PLATFORM_TONE: Record<Platform, 'green' | 'gray' | 'blue' | 'violet' | 'amber'> = {
  android: 'green',
  ios: 'gray',
  windows: 'blue',
  macos: 'violet',
  linux: 'amber',
};

/* ------------------------------ Profile editor ------------------------------ */

type Draft = Omit<ProfileInput, 'tags'> & { tags: string };

const emptyDraft: Draft = {
  name: '',
  platform: 'android',
  formFactor: 'mobile',
  vendor: '',
  model: '',
  osVersion: '15',
  browser: 'chrome',
  browserVersion: '142',
  userAgent: '',
  viewportWidth: 412,
  viewportHeight: 839,
  screenWidth: 412,
  screenHeight: 915,
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  timezone: 'UTC',
  tags: '',
  enabled: true,
};

function ProfileEditor({ profile, onClose }: { profile: DeviceProfile | null; onClose: () => void }) {
  const save = useSaveProfile();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() =>
    profile
      ? { ...profile, vendor: profile.vendor ?? '', model: profile.model ?? '', tags: profile.tags.join(', '), userAgent: profile.userAgent }
      : emptyDraft,
  );
  const [customUa, setCustomUa] = useState(false);
  const [preview, setPreview] = useState<string>('');
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const debounced = useDebounced(d, 250);

  useEffect(() => {
    if (customUa) return;
    let cancelled = false;
    api
      .post<{ userAgent: string }>('/api/profiles/user-agent', {
        platform: debounced.platform,
        formFactor: debounced.formFactor,
        model: debounced.model || null,
        osVersion: debounced.osVersion || '1',
        browser: debounced.browser,
        browserVersion: debounced.browserVersion || '1',
      })
      .then((r) => !cancelled && setPreview(r.userAgent))
      .catch((e: Error) => !cancelled && setPreview(`⚠ ${e.message}`));
    return () => {
      cancelled = true;
    };
  }, [debounced.platform, debounced.formFactor, debounced.model, debounced.osVersion, debounced.browser, debounced.browserVersion, customUa]);

  const submit = async () => {
    const body: Partial<ProfileInput> = {
      ...d,
      vendor: d.vendor || null,
      model: d.model || null,
      tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean),
      userAgent: customUa ? d.userAgent : undefined,
    };
    if (profile && !customUa) delete body.userAgent;
    try {
      await save.mutateAsync({ id: profile?.id, data: body });
      toast.success(profile ? 'Profile updated' : 'Profile created');
      onClose();
    } catch {
      /* inline */
    }
  };

  const num = (k: keyof Draft, label: string, step = 1) => (
    <Field label={label}>
      {(id) => <Input id={id} type="number" step={step} value={d[k] as number} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<Draft>)} />}
    </Field>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={profile ? 'Edit device profile' : 'New device profile'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!d.name.trim()} onClick={submit}>
            {profile ? 'Save changes' : 'Create profile'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Name" className="md:col-span-2">{(id) => <Input id={id} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Pixel 8 · Chrome 142 · Android 15" />}</Field>
        <Field label="Vendor">{(id) => <Input id={id} value={d.vendor ?? ''} onChange={(e) => set({ vendor: e.target.value })} />}</Field>
        <Field label="Model" hint="Samsung model codes (SM-…) appear in Samsung Internet UAs">{(id) => <Input id={id} value={d.model ?? ''} onChange={(e) => set({ model: e.target.value })} />}</Field>
        <Field label="Platform">
          {(id) => (
            <Select id={id} value={d.platform} onChange={(e) => set({ platform: e.target.value as Platform })}>
              {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="OS version">{(id) => <Input id={id} value={d.osVersion} onChange={(e) => set({ osVersion: e.target.value })} />}</Field>
        <Field label="Form factor">
          {(id) => (
            <Select id={id} value={d.formFactor} onChange={(e) => set({ formFactor: e.target.value as Draft['formFactor'] })}>
              {FORM_FACTORS.map((p) => <option key={p} value={p}>{FORM_LABEL[p]}</option>)}
            </Select>
          )}
        </Field>
        <div />
        <Field label="Browser">
          {(id) => (
            <Select id={id} value={d.browser} onChange={(e) => set({ browser: e.target.value as BrowserFamily })}>
              {BROWSERS.map((b) => <option key={b} value={b}>{BROWSER_LABEL[b]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Browser version">{(id) => <Input id={id} value={d.browserVersion} onChange={(e) => set({ browserVersion: e.target.value })} />}</Field>
        <Field label="Locale">{(id) => <Input id={id} value={d.locale} onChange={(e) => set({ locale: e.target.value })} placeholder="en-US" />}</Field>
        <Field label="Timezone">{(id) => <Input id={id} value={d.timezone} onChange={(e) => set({ timezone: e.target.value })} placeholder="Europe/London" />}</Field>
        {num('viewportWidth', 'Viewport width')}
        {num('viewportHeight', 'Viewport height')}
        {num('screenWidth', 'Screen width')}
        {num('screenHeight', 'Screen height')}
        {num('deviceScaleFactor', 'Device pixel ratio', 0.05)}
        <div className="flex flex-col justify-end gap-2 pb-1 md:col-span-3">
          <div className="flex flex-wrap gap-6">
            <Checkbox checked={d.isMobile} onChange={(v) => set({ isMobile: v })} label="Mobile (meta viewport, mobile UA behaviour)" />
            <Checkbox checked={d.hasTouch} onChange={(v) => set({ hasTouch: v })} label="Touch screen" />
            <Checkbox checked={!!d.enabled} onChange={(v) => set({ enabled: v })} label="Enabled" />
          </div>
        </div>
        <Field label="Tags" hint="Comma separated" className="md:col-span-4">{(id) => <Input id={id} value={d.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="priority, emea" />}</Field>
        <div className="md:col-span-4">
          <Toggle checked={customUa} onChange={setCustomUa} label="Custom user agent" description="Off: the user agent and client hints are generated from the fields above." />
          <div className="mt-2">
            {customUa ? (
              <Textarea rows={3} value={d.userAgent ?? ''} onChange={(e) => set({ userAgent: e.target.value })} />
            ) : (
              <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/60"><Mono>{preview || '…'}</Mono></div>
            )}
          </div>
        </div>
      </div>
      <ErrorNotice error={save.error} className="mt-4" />
    </Dialog>
  );
}

/* ------------------------------ Profile builder ----------------------------- */

function ProfileBuilder({ onClose }: { onClose: () => void }) {
  const { data: catalog } = useCatalog();
  const gen = useGenerateProfiles();
  const toast = useToast();
  const [platforms, setPlatforms] = useState<Platform[]>(['android', 'ios']);
  const [devices, setDevices] = useState<Set<string>>(new Set());
  const [browsers, setBrowsers] = useState<BrowserFamily[]>(['chrome', 'safari', 'samsung']);
  const [versions, setVersions] = useState(3);
  const [locale, setLocale] = useState('en-US');
  const [timezone, setTimezone] = useState('UTC');
  const [preview, setPreview] = useState<GenerateResult | null>(null);

  const visible = useMemo(() => (catalog?.devices ?? []).filter((d) => platforms.includes(d.platform)), [catalog, platforms]);
  const body = { deviceIds: [...devices], browsers, browserVersionsPerBrowser: versions, locale, timezone };
  const key = JSON.stringify(body);
  const lastKey = useRef('');

  useEffect(() => {
    if (!devices.size || !browsers.length) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      lastKey.current = key;
      gen.mutateAsync({ ...body, dryRun: true }).then((r) => lastKey.current === key && setPreview(r)).catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const run = async () => {
    try {
      const r = await gen.mutateAsync({ ...body, dryRun: false });
      toast.success(`${fmtNum(r.created)} profiles added`, r.skipped ? `${fmtNum(r.skipped)} already existed` : undefined);
      onClose();
    } catch (e) {
      toast.error('Generation failed', e);
    }
  };

  const toggleAll = (on: boolean) => setDevices(on ? new Set(visible.map((d) => d.id)) : new Set());

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="Profile builder"
      description="Combine catalog devices with browsers and versions. Each combination becomes a profile; existing ones are skipped."
      footer={
        <>
          <span className="mr-auto self-center text-sm text-slate-500">
            {preview ? `${fmtNum(preview.generated)} combinations · ${fmtNum(preview.generated - preview.skipped)} new` : 'Select devices and browsers'}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Sparkles className="size-4" />} disabled={!preview || preview.generated === preview.skipped} loading={gen.isPending && !!preview} onClick={run}>
            Generate profiles
          </Button>
        </>
      }
    >
      {!catalog ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <ChipFilter label="Platforms" options={PLATFORMS} value={platforms} onChange={setPlatforms} format={(v) => PLATFORM_LABEL[v]!} />
            <ChipFilter label="Browsers" options={BROWSERS} value={browsers} onChange={setBrowsers} format={(v) => BROWSER_LABEL[v]!} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Versions per browser" hint="Newest N releases (Safari follows the OS)">
              {(id) => <Input id={id} type="number" min={1} max={20} value={versions} onChange={(e) => setVersions(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />}
            </Field>
            <Field label="Locale">{(id) => <Input id={id} value={locale} onChange={(e) => setLocale(e.target.value)} />}</Field>
            <Field label="Timezone">{(id) => <Input id={id} value={timezone} onChange={(e) => setTimezone(e.target.value)} />}</Field>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Devices ({devices.size} of {visible.length})</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => toggleAll(true)}>Select all</Button>
                <Button size="sm" variant="ghost" onClick={() => toggleAll(false)}>Clear</Button>
              </div>
            </div>
            <div className="grid max-h-72 gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2 lg:grid-cols-3 dark:border-slate-800">
              {visible.map((dev) => (
                <label key={dev.id} className={cx('flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm', devices.has(dev.id) ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50')}>
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-indigo-600"
                    checked={devices.has(dev.id)}
                    onChange={() => setDevices((p) => { const n = new Set(p); if (n.has(dev.id)) n.delete(dev.id); else n.add(dev.id); return n; })}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{dev.vendor === 'Generic' ? dev.model : `${dev.vendor} ${dev.model}`}</span>
                    <span className="block text-[11px] text-slate-500">{PLATFORM_LABEL[dev.platform]} · {dev.viewportWidth}×{dev.viewportHeight} · OS {dev.osVersions.join(', ')}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          {preview && preview.preview.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Preview</div>
              <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                {preview.preview.map((p, i) => (
                  <li key={i} className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-900/60">
                    <div className="text-sm font-medium">{p.name}</div>
                    <Mono className="text-slate-500">{p.userAgent}</Mono>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ErrorNotice error={gen.error} />
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------- Import dialog ------------------------------ */

function ImportProfiles({ onClose }: { onClose: () => void }) {
  const imp = useImportProfiles();
  const toast = useToast();
  const [overwrite, setOverwrite] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [items, setItems] = useState<unknown[] | null>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setParseError(null);
    try {
      const json = JSON.parse(await f.text()) as { profiles?: unknown[] } | unknown[];
      const list = Array.isArray(json) ? json : json.profiles;
      if (!Array.isArray(list) || !list.length) throw new Error('Expected {"profiles": [...]} or an array of profiles');
      setItems(list);
    } catch (e) {
      setParseError((e as Error).message);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Import profiles"
      description="Import a JSON file exported from this app (or the same shape)."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!items}
            loading={imp.isPending}
            onClick={async () => {
              try {
                const r = await imp.mutateAsync({ profiles: items!, onConflict: overwrite ? 'overwrite' : 'skip' });
                toast.success('Profiles imported', `${r.created} new · ${r.updated} updated · ${r.skipped} skipped`);
                onClose();
              } catch {
                /* inline */
              }
            }}
          >
            Import {items ? fmtNum(items.length) : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input type="file" accept=".json,application/json" onChange={(e) => void onFile(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-indigo-700" />
        <Checkbox checked={overwrite} onChange={setOverwrite} label="Overwrite profiles with the same slug" />
        {parseError && <ErrorNotice error={parseError} />}
        <ErrorNotice error={imp.error} />
      </div>
    </Dialog>
  );
}

/* ----------------------------------- Page ----------------------------------- */

export function Profiles() {
  const toast = useToast();
  const [filter, setFilter] = useState<ProfileFilter>({});
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [editing, setEditing] = useState<DeviceProfile | null | 'new'>(null);
  const [dialog, setDialog] = useState<'builder' | 'import' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<false | 'bulk' | DeviceProfile>(false);
  const [menu, setMenu] = useState<number | null>(null);

  const effective: ProfileFilter = { ...filter, enabled: enabledFilter === 'all' ? undefined : enabledFilter === 'enabled' };
  const debounced = useDebounced(effective);
  const { data, isLoading } = useProfiles({ ...debounced, page, pageSize: 50, sort: 'platform' });
  const { data: facets } = useFacets(debounced);
  const { data: allFacets } = useFacets({});
  const bulk = useBulkProfiles();
  const del = useDeleteProfile();
  const save = useSaveProfile();

  useEffect(() => {
    setSelected(new Set());
    setAllMatching(false);
    setPage(1);
  }, [JSON.stringify(debounced)]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectionCount = allMatching ? (data?.total ?? 0) : selected.size;
  const selection = allMatching ? { filter: debounced } : { ids: [...selected] };

  const doBulk = async (action: 'enable' | 'disable' | 'delete') => {
    try {
      const r = await bulk.mutateAsync({ selection, action });
      toast.success(`${fmtNum(r.affected)} profiles ${action === 'delete' ? 'deleted' : action + 'd'}`);
      setSelected(new Set());
      setAllMatching(false);
    } catch (e) {
      toast.error('Bulk action failed', e);
    }
  };

  const pageAllSelected = !!data?.items.length && data.items.every((p) => selected.has(p.id));

  return (
    <>
      <PageHeader
        title="Device profiles"
        description={
          allFacets
            ? `${fmtNum(allFacets.total)} profiles in the library · ${fmtNum(allFacets.enabled)} enabled. Profiles are data; browsers launch only while a run executes.`
            : 'Your device compatibility library.'
        }
        actions={
          <>
            <a href="/api/profiles/export" download><Button icon={<Download className="size-4" />}>Export</Button></a>
            <Button icon={<Upload className="size-4" />} onClick={() => setDialog('import')}>Import</Button>
            <Button icon={<Wand2 className="size-4" />} onClick={() => setDialog('builder')}>Profile builder</Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>New profile</Button>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[18rem_1fr]">
        <Card className="h-fit p-5">
          <ProfileFilters filter={filter} onChange={setFilter} facets={facets} showSource />
          <div className="mt-4">
            <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">State</div>
            <Select value={enabledFilter} onChange={(e) => setEnabledFilter(e.target.value as typeof enabledFilter)}>
              <option value="all">All</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </Select>
          </div>
        </Card>
        <Card className="min-w-0">
          {selectionCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-indigo-50/60 px-5 py-2.5 text-sm dark:border-slate-800 dark:bg-indigo-500/10">
              <span className="font-medium">{fmtNum(selectionCount)} selected</span>
              {!allMatching && pageAllSelected && data && data.total > data.items.length && (
                <button className="text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => setAllMatching(true)}>
                  Select all {fmtNum(data.total)} matching
                </button>
              )}
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => doBulk('enable')} loading={bulk.isPending}>Enable</Button>
                <Button size="sm" onClick={() => doBulk('disable')} loading={bulk.isPending}>Disable</Button>
                <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete('bulk')}>Delete</Button>
              </div>
            </div>
          )}
          {isLoading ? (
            <LoadingBlock />
          ) : !data?.items.length ? (
            <EmptyState icon={<Smartphone className="size-5" />} title="No profiles match" description="Adjust the filters, or add profiles with the profile builder." />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th className="w-8">
                      <Checkbox
                        checked={pageAllSelected || allMatching}
                        indeterminate={data.items.some((p) => selected.has(p.id))}
                        onChange={(v) => {
                          setAllMatching(false);
                          setSelected((prev) => {
                            const n = new Set(prev);
                            for (const p of data.items) {
                              if (v) n.add(p.id);
                              else n.delete(p.id);
                            }
                            return n;
                          });
                        }}
                      />
                    </Th>
                    <Th>Profile</Th>
                    <Th>Platform</Th>
                    <Th>Browser</Th>
                    <Th>Engine</Th>
                    <Th>Viewport</Th>
                    <Th>Source</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.items.map((p) => (
                    <tr key={p.id} className={cx(!p.enabled && 'opacity-55', (allMatching || selected.has(p.id)) && 'bg-indigo-50/40 dark:bg-indigo-500/5')}>
                      <Td>
                        <Checkbox
                          checked={allMatching || selected.has(p.id)}
                          onChange={() => {
                            setAllMatching(false);
                            setSelected((prev) => {
                              const n = new Set(prev);
                              if (n.has(p.id)) n.delete(p.id);
                              else n.add(p.id);
                              return n;
                            });
                          }}
                        />
                      </Td>
                      <Td className="max-w-sm">
                        <button className="block max-w-full truncate text-left font-medium text-slate-900 hover:text-indigo-600 dark:text-white" onClick={() => setEditing(p)}>
                          {p.name}
                        </button>
                        <Mono className="block truncate text-[11px] text-slate-500" >{p.userAgent}</Mono>
                      </Td>
                      <Td>
                        <Badge tone={PLATFORM_TONE[p.platform]}>{PLATFORM_LABEL[p.platform]} {p.osVersion}</Badge>
                        <div className="mt-0.5 text-[11px] text-slate-500">{FORM_LABEL[p.formFactor]}</div>
                      </Td>
                      <Td className="text-xs whitespace-nowrap">{BROWSER_LABEL[p.browser]} {p.browserVersion}</Td>
                      <Td className="text-xs">{ENGINE_LABEL[p.engine]}</Td>
                      <Td className="font-mono text-xs whitespace-nowrap tabular">{p.viewportWidth}×{p.viewportHeight}<span className="text-slate-400"> @{p.deviceScaleFactor}x</span></Td>
                      <Td><Badge>{p.source}</Badge></Td>
                      <Td className="relative text-right">
                        <Button size="sm" variant="ghost" aria-label="Actions" icon={<MoreHorizontal className="size-4" />} onClick={() => setMenu(menu === p.id ? null : p.id)} />
                        {menu === p.id && (
                          <div className="absolute right-4 z-10 mt-1 w-40 rounded-lg bg-white py-1 text-left text-sm shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700" onMouseLeave={() => setMenu(null)}>
                            <button className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => { setMenu(null); setEditing(p); }}>
                              <Pencil className="size-3.5" /> Edit
                            </button>
                            <button
                              className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                              onClick={async () => {
                                setMenu(null);
                                try {
                                  await save.mutateAsync({ id: p.id, data: { enabled: !p.enabled } });
                                } catch (e) {
                                  toast.error('Update failed', e);
                                }
                              }}
                            >
                              {p.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button className="flex w-full items-center gap-2 px-3 py-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10" onClick={() => { setMenu(null); setConfirmDelete(p); }}>
                              <Trash2 className="size-3.5" /> Delete
                            </button>
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />
            </>
          )}
        </Card>
      </div>

      {allFacets && allFacets.total > 9000 && (
        <Notice className="mt-4">The library holds {fmtNum(allFacets.total)} profiles. Runs only open as many browser sessions as the concurrency settings allow, regardless of library size.</Notice>
      )}

      {editing && <ProfileEditor profile={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {dialog === 'builder' && <ProfileBuilder onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportProfiles onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete === 'bulk' ? `Delete ${fmtNum(selectionCount)} profiles?` : 'Delete this profile?'}
        message="Deleted profiles are removed from the library. Past runs keep their own snapshot of each profile."
        confirmLabel="Delete"
        danger
        loading={bulk.isPending || del.isPending}
        onConfirm={async () => {
          if (confirmDelete === 'bulk') await doBulk('delete');
          else if (confirmDelete) {
            try {
              await del.mutateAsync(confirmDelete.id);
              toast.success('Profile deleted');
            } catch (e) {
              toast.error('Delete failed', e);
            }
          }
          setConfirmDelete(false);
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
