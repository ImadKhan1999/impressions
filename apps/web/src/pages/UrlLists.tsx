import { Globe, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSaveUrlList, useUrlLists } from '../api/hooks';
import { Button, Card, Dialog, EmptyState, ErrorNotice, Field, Input, LoadingBlock, PageHeader, Table, Td, Textarea, Th, useToast } from '../components/ui';
import { fmtNum, fmtRelative } from '../lib/format';

export function ListDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: { id: number; name: string; description: string | null } }) {
  const save = useSaveUrlList();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const submit = async () => {
    try {
      const l = await save.mutateAsync({ id: initial?.id, data: { name: name.trim(), description: description.trim() || null } });
      toast.success(initial ? 'List updated' : 'List created');
      onClose();
      if (!initial) navigate(`/urls/${l.id}?import=1`);
    } catch {
      /* shown inline */
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? 'Edit URL list' : 'New URL list'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={submit}>
            {initial ? 'Save' : 'Create and import'}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Name">{(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder="Spring campaign landing pages" />}</Field>
        <Field label="Description" hint="Optional">{(id) => <Textarea id={id} rows={3} className="font-sans text-sm" value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <ErrorNotice error={save.error} />
      </form>
    </Dialog>
  );
}

export function UrlLists() {
  const { data: lists, isLoading } = useUrlLists();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="URL lists"
        description="Organise the URLs you test. Import thousands at once from TXT or CSV files."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>New list</Button>}
      />
      <Card>
        {isLoading ? (
          <LoadingBlock />
        ) : !lists?.length ? (
          <EmptyState
            icon={<Globe className="size-5" />}
            title="No URL lists yet"
            description="Create a list, then upload a .txt file (one URL per line) or a .csv with a url column."
            action={<Button variant="primary" onClick={() => setOpen(true)}>Create a list</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th className="text-right">URLs</Th>
                <Th className="text-right">Domains</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {lists.map((l) => (
                <tr key={l.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => navigate(`/urls/${l.id}`)}>
                  <Td>
                    <div className="font-medium text-slate-900 dark:text-white">{l.name}</div>
                    {l.description && <div className="max-w-xl truncate text-xs text-slate-500">{l.description}</div>}
                  </Td>
                  <Td className="text-right tabular">{fmtNum(l.urlCount)}</Td>
                  <Td className="text-right tabular">{fmtNum(l.domainCount)}</Td>
                  <Td className="text-xs text-slate-500">{fmtRelative(l.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {open && <ListDialog open onClose={() => setOpen(false)} />}
    </>
  );
}
