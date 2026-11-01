import { Network, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { PROXY_PROTOCOLS, type Proxy, type ProxyProtocol } from '@impressions/shared';
import { useDeleteProxy, useProxies, useSaveProxy, useTestProxy } from '../api/hooks';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  useToast,
} from '../components/ui';
import { fmtRelative } from '../lib/format';

const DEFAULT_PORT: Record<ProxyProtocol, number> = { http: 8080, https: 443, socks4: 1080, socks5: 1080 };

function ProxyDialog({ proxy, onClose }: { proxy: Proxy | null; onClose: () => void }) {
  const save = useSaveProxy();
  const toast = useToast();
  const [name, setName] = useState(proxy?.name ?? '');
  const [protocol, setProtocol] = useState<ProxyProtocol>(proxy?.protocol ?? 'http');
  const [host, setHost] = useState(proxy?.host ?? '');
  const [port, setPort] = useState(proxy?.port ?? 8080);
  const [username, setUsername] = useState(proxy?.username ?? '');
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [remoteDns, setRemoteDns] = useState(proxy?.remoteDns ?? true);
  const [notes, setNotes] = useState(proxy?.notes ?? '');

  const submit = async () => {
    try {
      await save.mutateAsync({
        id: proxy?.id,
        data: {
          name: name.trim(),
          protocol,
          host: host.trim(),
          port,
          username: username.trim() || null,
          ...(password ? { password } : clearPassword ? { password: null } : proxy ? {} : { password: null }),
          remoteDns,
          notes: notes.trim() || null,
        },
      });
      toast.success(proxy ? 'Proxy updated' : 'Proxy added');
      onClose();
    } catch {
      /* inline */
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={proxy ? 'Edit proxy' : 'Add proxy'}
      description="Use proxies you are authorised to test through, such as a corporate gateway or a regional test network."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !host.trim()} onClick={submit}>
            {proxy ? 'Save' : 'Add proxy'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Office gateway (Frankfurt)" />}</Field>
        <Field label="Protocol">
          {(id) => (
            <Select
              id={id}
              value={protocol}
              onChange={(e) => {
                const p = e.target.value as ProxyProtocol;
                if (port === DEFAULT_PORT[protocol]) setPort(DEFAULT_PORT[p]);
                setProtocol(p);
              }}
            >
              {PROXY_PROTOCOLS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label="Host">{(id) => <Input id={id} value={host} onChange={(e) => setHost(e.target.value)} placeholder="proxy.example.com" />}</Field>
          <Field label="Port">{(id) => <Input id={id} type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} />}</Field>
        </div>
        <Field label="Username" hint="Optional">{(id) => <Input id={id} autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />}</Field>
        <Field label="Password" hint={proxy?.hasPassword ? 'Leave blank to keep the stored password' : 'Optional. Stored encrypted.'}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={proxy?.hasPassword ? '••••••••' : ''} />}
        </Field>
        {proxy?.hasPassword && <Checkbox className="sm:col-span-2" checked={clearPassword} onChange={setClearPassword} label="Remove the stored password" />}
        {(protocol === 'socks4' || protocol === 'socks5') && (
          <Checkbox
            className="sm:col-span-2"
            checked={remoteDns}
            onChange={setRemoteDns}
            label={`Resolve hostnames through the proxy (${protocol === 'socks4' ? 'SOCKS4a' : 'SOCKS5h'})`}
          />
        )}
        <Field label="Notes" className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} className="font-sans text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {(protocol === 'socks4' || protocol === 'socks5') && username && (
          <Notice tone="warn" className="sm:col-span-2">Browsers cannot authenticate to SOCKS proxies. This proxy will work for HTTP-engine runs only.</Notice>
        )}
        {protocol !== 'http' && protocol !== 'socks5' && (
          <Notice className="sm:col-span-2">In browser mode, {protocol.toUpperCase()} proxies are supported by the Chromium engine only.</Notice>
        )}
      </div>
      <ErrorNotice error={save.error} className="mt-4" />
    </Dialog>
  );
}

export function Proxies() {
  const { data: proxies, isLoading } = useProxies();
  const test = useTestProxy();
  const del = useDeleteProxy();
  const toast = useToast();
  const [editing, setEditing] = useState<Proxy | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Proxy | null>(null);
  const [testUrl, setTestUrl] = useState('https://example.com/');
  const [testing, setTesting] = useState<number | null>(null);

  const runTest = async (p: Proxy) => {
    setTesting(p.id);
    try {
      const r = await test.mutateAsync({ id: p.id, url: testUrl });
      if (r.ok) toast.success(`${p.name} is reachable`, `HTTP ${r.statusCode} in ${r.latencyMs} ms`);
      else toast.error(`${p.name} failed`, `${r.errorCode ?? ''} ${r.error ?? ''}`.trim());
    } catch (e) {
      toast.error('Test failed', e);
    }
    setTesting(null);
  };

  return (
    <>
      <PageHeader
        title="Proxies"
        description="Manually configured network routes for authorised compatibility testing."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add proxy</Button>}
      />
      <Notice className="mb-4">
        Each run uses one proxy you pick (or a direct connection) for all of its requests. Proxies are never rotated or cycled between requests.
      </Notice>
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <Field label="Test URL" className="w-full sm:w-96">{(id) => <Input id={id} value={testUrl} onChange={(e) => setTestUrl(e.target.value)} />}</Field>
        </div>
        {isLoading ? (
          <LoadingBlock />
        ) : !proxies?.length ? (
          <EmptyState icon={<Network className="size-5" />} title="No proxies configured" description="Runs use this computer's network connection until you add one." action={<Button variant="primary" onClick={() => setEditing('new')}>Add proxy</Button>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Endpoint</Th>
                <Th>Auth</Th>
                <Th>Last test</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {proxies.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <div className="font-medium text-slate-900 dark:text-white">{p.name}</div>
                    {p.notes && <div className="max-w-xs truncate text-xs text-slate-500">{p.notes}</div>}
                  </Td>
                  <Td>
                    <Badge tone="indigo">{p.protocol.toUpperCase()}</Badge> <span className="font-mono text-xs">{p.host}:{p.port}</span>
                  </Td>
                  <Td className="text-xs">{p.username ? `${p.username}${p.hasPassword ? ' · ••••' : ''}` : 'none'}</Td>
                  <Td className="text-xs">
                    {p.lastCheckedAt ? (
                      <span className="inline-flex flex-col">
                        <span>{p.lastCheckOk ? <Badge tone="green">ok · {p.lastCheckLatencyMs} ms</Badge> : <Badge tone="red">failed</Badge>}</span>
                        <span className="mt-0.5 text-slate-500">{fmtRelative(p.lastCheckedAt)}</span>
                        {p.lastCheckError && <span className="max-w-xs truncate text-rose-500">{p.lastCheckError}</span>}
                      </span>
                    ) : (
                      <span className="text-slate-400">never</span>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <Button size="sm" variant="subtle" icon={<Zap className="size-3.5" />} loading={testing === p.id} onClick={() => runTest(p)}>Test</Button>
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(p)} aria-label="Edit" />
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(p)} aria-label="Delete" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ProxyDialog proxy={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete proxy?"
        message={`"${deleting?.name}" will be removed. Runs that already used it keep their results.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(deleting!.id);
            toast.success('Proxy deleted');
          } catch (e) {
            toast.error('Delete failed', e);
          }
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
