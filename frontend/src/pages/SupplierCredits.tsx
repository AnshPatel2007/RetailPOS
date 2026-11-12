import { useState } from 'react';
import { CheckCircle2, Plus, Receipt } from 'lucide-react';
import { DataPanel, ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTabs } from '@/components/common/PageTabs';
import { EmptyState } from '@/components/common/EmptyState';
import { PickableSupplier, SupplierPicker } from '@/components/common/SupplierPicker';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Spinner } from '@/components/ui/LoadingState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/capabilities';
import { api } from '@/services/api';
import { formatCurrency, formatDate } from '@/lib/utils';

type Status = 'OPEN' | 'RECEIVED' | 'WRITTEN_OFF';
interface Credit {
  id: string; reason: keyof typeof REASONS; amount: number; status: Status; notes: string | null; receiptId: string | null;
  createdAt: string; settledAt: string | null; supplier: { id: string; name: string };
}
interface CreditList { credits: Credit[]; summary: { openCount: number; openAmount: number; olderThan30Amount: number } }

const REASONS = { DAMAGED: 'Damaged goods', REJECTED: 'Rejected goods', SHORT: 'Short delivery', PRICE: 'Price correction', RETURN: 'Returned goods', OTHER: 'Other' } as const;
const STATUS_LABEL: Record<Status, string> = { OPEN: 'Owed', RECEIVED: 'Received', WRITTEN_OFF: 'Written off' };
const errorText = (failure: unknown, fallback: string) => (failure as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

/**
 * Money suppliers owe the store: damaged or rejected goods an invoice still
 * charged for, returns, shortages and price corrections. Receiving creates most
 * of them; the rest are recorded here. Each is settled once, when the credit
 * arrives or is written off.
 */
export default function SupplierCredits() {
  const { locationId, isReadOnly } = useEffectiveLocation();
  const role = useAuthStore(state => state.user?.role);
  const canManage = can(role, 'inventory.manage') && !isReadOnly;
  const [view, setView] = useState<'open' | 'settled'>('open');
  const [adding, setAdding] = useState(false);
  const [settling, setSettling] = useState<{ credit: Credit; status: 'RECEIVED' | 'WRITTEN_OFF' } | null>(null);
  const query = useScopedQuery<CreditList>(['supplier-credits', locationId, view], async signal =>
    (await api.get('/suppliers/credits', { params: { status: view, locationId: locationId || undefined }, signal })).data.data, !!locationId);
  const summary = query.data?.summary;
  const credits = query.data?.credits || [];

  return (
    <ManagementPage>
      <PageHeader title="Credits Owed" icon={Receipt}
        secondaryTabs={<PageTabs secondary label="Credit status" value={view} onChange={value => setView(value as 'open' | 'settled')}
          items={[{ id: 'open', label: 'Owed' }, { id: 'settled', label: 'Settled' }]} />}
        actions={canManage ? <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" />Record credit</Button> : undefined} />
      {summary && <SummaryStrip items={[
        { label: 'Owed to you', value: formatCurrency(summary.openAmount), detail: `${summary.openCount} open credit${summary.openCount === 1 ? '' : 's'}` },
        { label: 'Older than 30 days', value: formatCurrency(summary.olderThan30Amount), tone: summary.olderThan30Amount > 0 ? 'warning' : 'default',
          detail: summary.olderThan30Amount > 0 ? 'Ask the supplier for these' : 'Nothing overdue' },
      ]} />}
      <DataPanel>
        {query.error ? <Alert tone="error" action={<Button size="sm" variant="outline" onClick={query.refresh}>Retry</Button>}>Credits did not load.</Alert>
          : !query.data ? <div className="flex justify-center py-10"><Spinner size="lg" /></div>
          : !credits.length ? <EmptyState icon={CheckCircle2} title={view === 'open' ? 'No supplier owes you anything' : 'No settled credits yet'}
              hint={view === 'open' ? 'Credits appear here when a delivery has damaged or rejected goods the invoice charged for, when goods go back to a supplier, or when you record one.' : 'Credits marked received or written off are listed here.'} />
          : <Table aria-label={view === 'open' ? 'Credits owed' : 'Settled credits'}>
            <TableHeader><TableRow>
              <TableHead>Supplier</TableHead><TableHead>Why</TableHead><TableHead className="text-right">Amount</TableHead>
              <TableHead>{view === 'open' ? 'Recorded' : 'Settled'}</TableHead><TableHead>Notes</TableHead>{view === 'open' && canManage && <TableHead><span className="sr-only">Actions</span></TableHead>}
            </TableRow></TableHeader>
            <TableBody>{credits.map(credit => <TableRow key={credit.id}>
              <TableCell className="font-medium">{credit.supplier.name}</TableCell>
              <TableCell>{REASONS[credit.reason] || credit.reason}{view === 'settled' && <div className="text-xs text-muted-foreground">{STATUS_LABEL[credit.status]}</div>}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(credit.amount)}</TableCell>
              <TableCell className="whitespace-nowrap">{formatDate(view === 'open' ? credit.createdAt : credit.settledAt || credit.createdAt)}</TableCell>
              <TableCell className="max-w-xs whitespace-pre-line text-sm text-muted-foreground">{credit.notes || '—'}</TableCell>
              {view === 'open' && canManage && <TableCell className="whitespace-nowrap text-right">
                <Button size="sm" variant="outline" onClick={() => setSettling({ credit, status: 'RECEIVED' })}>Mark received</Button>{' '}
                <Button size="sm" variant="ghost" onClick={() => setSettling({ credit, status: 'WRITTEN_OFF' })}>Write off</Button>
              </TableCell>}
            </TableRow>)}</TableBody>
          </Table>}
      </DataPanel>
      {adding && locationId && <RecordCredit locationId={locationId} onClose={() => setAdding(false)} />}
      {settling && <SettleCredit {...settling} onClose={() => setSettling(null)} />}
    </ManagementPage>
  );
}

function RecordCredit({ locationId, onClose }: { locationId: string; onClose: () => void }) {
  const [supplier, setSupplier] = useState<PickableSupplier | null>(null);
  const [reason, setReason] = useState<keyof typeof REASONS>('SHORT');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!supplier) { setError('Choose the supplier.'); return; }
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) { setError('Enter the amount owed.'); return; }
    if (reason === 'OTHER' && !notes.trim()) { setError('Describe the credit when choosing Other.'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/suppliers/credits', { supplierId: supplier.id, reason, amount: Math.round(value * 100) / 100, notes: notes.trim() || undefined });
      onClose();
    } catch (failure) { setError(errorText(failure, 'The credit was not saved. Try again.')); }
    finally { setSaving(false); }
  };
  return <Modal isOpen onClose={() => { if (!saving) onClose(); }} title="Record a credit owed" description="Money a supplier owes you, for example for a short delivery or a price they agreed to correct." size="md">
    <form onSubmit={save} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <SupplierPicker locationId={locationId} selected={supplier} onSelect={setSupplier} />
      <Select label="Why" value={reason} onChange={event => setReason(event.target.value as keyof typeof REASONS)}>
        {Object.entries(REASONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </Select>
      <Input label="Amount owed" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} />
      <Textarea label="Notes" value={notes} maxLength={2000} onChange={event => setNotes(event.target.value)} description="For example the invoice number or who at the supplier agreed to it." />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record credit'}</Button>
      </div>
    </form>
  </Modal>;
}

function SettleCredit({ credit, status, onClose }: { credit: Credit; status: 'RECEIVED' | 'WRITTEN_OFF'; onClose: () => void }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const received = status === 'RECEIVED';
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      await api.post(`/suppliers/credits/${credit.id}/settle`, { status, notes: notes.trim() || undefined });
      onClose();
    } catch (failure) { setError(errorText(failure, 'The credit was not updated. Try again.')); }
    finally { setSaving(false); }
  };
  return <Modal isOpen onClose={() => { if (!saving) onClose(); }} size="sm" title={received ? 'Mark credit received' : 'Write off credit'}
    description={`${credit.supplier.name} · ${REASONS[credit.reason] || credit.reason} · ${formatCurrency(credit.amount)}`}>
    <form onSubmit={save} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm text-muted-foreground">{received
        ? 'The supplier paid or credited this amount. It leaves the list of credits owed.'
        : 'You no longer expect this money. It leaves the list of credits owed and stays on record as written off.'}</p>
      <Input label={received ? 'Credit note or reference (optional)' : 'Reason (optional)'} value={notes} maxLength={500} onChange={event => setNotes(event.target.value)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button type="submit" variant={received ? 'default' : 'destructive'} disabled={saving}>{saving ? 'Saving…' : received ? 'Mark received' : 'Write off'}</Button>
      </div>
    </form>
  </Modal>;
}
