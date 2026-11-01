import { ArrowLeft, FileUp, Pencil, Play, Search, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LIMITS, type ImportReport } from '@impressions/shared';
import { useDeleteUrlList, useDeleteUrls, useImportUrls, useUrlList, useUrls } from '../api/hooks';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorNotice,
  Input,
  LoadingBlock,
  Mono,
  PageHeader,
  Pagination,
  Segmented,
  Table,
  Td,
  Textarea,
  Th,
  cx,
  useDebounced,
  useToast,
} from '../components/ui';
import { fmtBytes, fmtNum } from '../lib/format';
import { ListDialog } from './UrlLists';

function ImportResult({ report }: { report: ImportReport }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Added', report.inserted, 'text-emerald-600'],
          ['Duplicates', report.duplicates, 'text-slate-600'],
          ['Rejected', report.rejected, report.rejected ? 'text-rose-600' : 'text-slate-600'],
          ['Lines read', report.totalLines, 'text-slate-600'],
        ].map(([k, v, c]) => (
          <div key={k as string} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60">
            <div className="text-xs text-slate-500">{k}</div>
            <div className={cx('text-lg font-semibold tabular', c as string)}>{fmtNum(v as number)}</div>
          </div>
        ))}
      </div>
      {report.rejects.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <Table>
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900"><tr><Th>Line</Th><Th>Value</Th><Th>Reason</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.rejects.map((r, i) => (
                <tr key={i}>
                  <Td className="tabular">{r.line}</Td>
                  <Td className="max-w-56"><Mono className="block truncate">{r.value || '–'}</Mono></Td>
                  <Td className="text-xs text-rose-600 dark:text-rose-400">{r.reason}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {report.rejectsTruncated && <p className="text-xs text-slate-500">Only the first {report.rejects.length} rejected lines are shown.</p>}
    </div>
  );
}

function ImportDialog({ listId, open, onClose }: { listId: number; open: boolean; onClose: () => void }) {
  const imp = useImportUrls(listId);
  const toast = useToast();
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [drag, setDrag] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > LIMITS.maxImportBytes) {
      toast.error('File too large', `The limit is ${fmtBytes(LIMITS.maxImportBytes)}.`);
      return;
    }
    setFile(f);
    setReport(null);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files[0]);
  };
  const submit = async () => {
    try {
      const r = await imp.mutateAsync(mode === 'file' ? { file: file! } : { text });
      setReport(r);
      toast.success('Import finished', `${fmtNum(r.inserted)} URLs added`);
    } catch {
      /* inline */
    }
  };
  const close = () => {
    setFile(null);
    setText('');
    setReport(null);
    imp.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title="Import URLs"
      description="TXT: one URL per line (# comments allowed). CSV: a url column, plus optional label and tags columns. Duplicates are skipped."
      footer={
        report ? (
          <Button variant="primary" onClick={close}>Done</Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" icon={<Upload className="size-4" />} loading={imp.isPending} disabled={mode === 'file' ? !file : !text.trim()} onClick={submit}>
              Import
            </Button>
          </>
        )
      }
    >
      {report ? (
        <ImportResult report={report} />
      ) : (
        <div className="space-y-4">
          <Segmented value={mode} onChange={setMode} options={[{ value: 'file', label: 'Upload file' }, { value: 'paste', label: 'Paste URLs' }]} />
          {mode === 'file' ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              onClick={() => input.current?.click()}
              className={cx(
                'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition',
                drag ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-300 hover:border-slate-400 dark:border-slate-700',
              )}
            >
              <FileUp className="size-8 text-slate-400" />
              {file ? (
                <>
                  <div className="mt-3 text-sm font-medium">{file.name}</div>
                  <div className="text-xs text-slate-500">{fmtBytes(file.size)} · click to choose another</div>
                </>
              ) : (
                <>
                  <div className="mt-3 text-sm font-medium">Drop a .txt or .csv file here, or click to browse</div>
                  <div className="text-xs text-slate-500">Up to {fmtBytes(LIMITS.maxImportBytes)} · UTF-8 or UTF-16 · comma, semicolon or tab separated</div>
                </>
              )}
              <input ref={input} type="file" accept=".txt,.csv,.tsv,text/plain,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            </div>
          ) : (
            <Textarea rows={10} placeholder={'https://example.com/landing\nexample.org/promo?utm_source=test'} value={text} onChange={(e) => setText(e.target.value)} />
          )}
          <ErrorNotice error={imp.error} />
        </div>
      )}
    </Dialog>
  );
}

export function UrlListDetail() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: list, isLoading, error } = useUrlList(id);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState<'list' | 'urls' | null>(null);
  const importOpen = params.get('import') === '1';
  const q = useDebounced(search);
  const { data: urls } = useUrls(id, { page, pageSize: 50, q: q || undefined });
  const delList = useDeleteUrlList();
  const delUrls = useDeleteUrls(id);

  if (isLoading) return <LoadingBlock />;
  if (error || !list) return <EmptyState title="List not found" action={<Link to="/urls"><Button>Back</Button></Link>} />;

  const toggle = (uid: number) => setSelected((p) => { const n = new Set(p); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });

  return (
    <>
      <PageHeader
        title={list.name}
        description={`${fmtNum(list.urlCount)} URLs across ${fmtNum(list.domainCount)} domains${list.description ? ` · ${list.description}` : ''}`}
        actions={
          <>
            <Link to="/urls"><Button variant="ghost" icon={<ArrowLeft className="size-4" />}>Lists</Button></Link>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>Edit</Button>
            <Button icon={<Upload className="size-4" />} onClick={() => setParams({ import: '1' })}>Import</Button>
            <Button variant="primary" icon={<Play className="size-4" />} disabled={!list.urlCount} onClick={() => navigate(`/runs/new?list=${id}`)}>Test this list</Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search URLs or labels" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm('urls')}>
                Delete {fmtNum(selected.size)}
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm('list')}>Delete list</Button>
          </div>
        </div>
        {!urls?.items.length ? (
          <EmptyState
            icon={<FileUp className="size-5" />}
            title={q ? 'No URLs match' : 'This list is empty'}
            description={q ? undefined : 'Import a TXT or CSV file, or paste URLs.'}
            action={!q && <Button variant="primary" onClick={() => setParams({ import: '1' })}>Import URLs</Button>}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="w-8">
                    <Checkbox
                      checked={urls.items.every((u) => selected.has(u.id))}
                      indeterminate={urls.items.some((u) => selected.has(u.id))}
                      onChange={(v) => setSelected((p) => { const n = new Set(p); for (const u of urls.items) { if (v) n.add(u.id); else n.delete(u.id); } return n; })}
                    />
                  </Th>
                  <Th>URL</Th>
                  <Th>Domain</Th>
                  <Th>Label</Th>
                  <Th>Tags</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {urls.items.map((u) => (
                  <tr key={u.id} className={cx(selected.has(u.id) && 'bg-indigo-50/50 dark:bg-indigo-500/5')}>
                    <Td><Checkbox checked={selected.has(u.id)} onChange={() => toggle(u.id)} /></Td>
                    <Td className="max-w-lg"><Mono className="block truncate">{u.url}</Mono></Td>
                    <Td className="text-xs">{u.domain}</Td>
                    <Td className="max-w-48 truncate text-xs">{u.label ?? '–'}</Td>
                    <Td className="space-x-1">{u.tags.map((t) => <Badge key={t}>{t}</Badge>)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={50} total={urls.total} onPage={setPage} />
          </>
        )}
      </Card>

      <ImportDialog listId={id} open={importOpen} onClose={() => setParams({})} />
      {edit && <ListDialog open initial={list} onClose={() => setEdit(false)} />}
      <ConfirmDialog
        open={confirm === 'urls'}
        title={`Delete ${selected.size} URLs?`}
        message="They are removed from this list. Past run results are kept."
        confirmLabel="Delete"
        danger
        loading={delUrls.isPending}
        onConfirm={async () => {
          try {
            const r = await delUrls.mutateAsync({ ids: [...selected] });
            toast.success(`${fmtNum(r.deleted)} URLs deleted`);
            setSelected(new Set());
          } catch (e) {
            toast.error('Delete failed', e);
          }
          setConfirm(null);
        }}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'list'}
        title="Delete this list?"
        message={`All ${fmtNum(list.urlCount)} URLs in "${list.name}" will be deleted. Past run results are kept.`}
        confirmLabel="Delete list"
        danger
        loading={delList.isPending}
        onConfirm={async () => {
          try {
            await delList.mutateAsync(id);
            toast.success('List deleted');
            navigate('/urls');
          } catch (e) {
            toast.error('Delete failed', e);
            setConfirm(null);
          }
        }}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
