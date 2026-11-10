import { Alert } from '@/components/ui/Alert';
import { LoadingState } from '@/components/ui/LoadingState';
import { Pagination } from '@/components/common/Pagination';
import { formatDate, formatCurrency, formatEnumLabel } from '@/lib/utils';
import { today } from '@internationalized/date';
import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/services/api';
import { useScopedQuery, invalidateScopedQueries } from '@/hooks/useScopedQuery';
import { useUrlFilter } from '@/hooks/useUrlFilter';
import { useSavedOperation } from '@/hooks/useSavedOperation';
import { PageTabs } from '@/components/common/PageTabs';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/Table';
import { OpeningInventoryReview } from './OpeningInventoryReview';
import toast from 'react-hot-toast';

type Balance = { id: string; name: string; sku: string; quantity: number; stockVersion: number; supplierPrice: number; value: number | null; averageCost: number | null; openingConfirmed: boolean };
type Entry = { id: string; productName: string; sku: string; kind: string; quantity: number; valueChange: string | null; valueAfter: string | null;
  cogsAmount: string | null; sourceId: string; createdAt: string; notes: string | null };
type Page<T> = T & { pagination: { page: number; total: number; totalPages: number } };
type Reconciliation = { opening: { value: number | null }; closing: { value: number | null; missingProducts: number };
  movements: { kind: string; value: number | null; quantity: number; entries: number }[]; inTransit: { value: number | null; quantity: number }; complete: boolean };
type Preview = { token: string; explanation: string; changes: { entryId: string; kind: string; previousCogs: string | null; cogsAmount: string | null; previousValue: string | null; valueAfter: string | null }[] };
const money = (value: number | string | null | undefined) => value == null ? 'Unavailable' : formatCurrency(Number(value));
const label = (value: string) => formatEnumLabel(value);
const endpoint = '/financial/inventory-costs';
const errorText = (error: unknown) => (error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Unable to save. Try again.';

export function InventoryCostPanel({ locationId, owner, readOnly }: { locationId?: string; owner: boolean; readOnly: boolean }) {
  const timezone = useCalendarTimezone();
  const [tab, setTab] = useUrlFilter('costTab', 'balances');
  const [url, setUrl] = useSearchParams();
  const kind = url.get('costKind') || undefined, ledgerMonth = url.get('costMonth') || undefined;
  const linkMovements = (movement?: string) => setUrl(current => { const next = new URLSearchParams(current);
    next.set('costTab', 'ledger'); if (movement) { next.set('costKind', movement); next.set('costMonth', month); }
    else { next.delete('costKind'); next.delete('costMonth'); } return next; });
  const view = ['balances', 'valuation', 'missing', 'ledger', 'reconciliation'].includes(tab) ? tab : 'balances';
  const [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [month, setMonth] = useState(today(timezone).toString().slice(0, 7));
  const [asOf, setAsOf] = useState(today(timezone).toString());
  const [opening, setOpening] = useState<Balance | null>(null), [selected, setSelected] = useState<Entry | null>(null);
  const [bulkOpening, setBulkOpening] = useState(false);
  const [action, setAction] = useState<'correction' | 'return' | 'details'>('details');
  const [quantity, setQuantity] = useState(''), [value, setValue] = useState(''), [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operation = useSavedOperation('inventory-cost', endpoint + '/', () => {
    setOpening(null); setSelected(null); setPreview(null); setBulkOpening(false); invalidateScopedQueries(); toast.success('Inventory costs updated');
  });
  const editing = !!opening || !!selected || bulkOpening;
  useEffect(() => { setPage(1); }, [view, search, locationId, kind, ledgerMonth]);
  useEffect(() => { setOpening(null); setSelected(null); setPreview(null); setBulkOpening(false); setError(''); }, [locationId]);
  const params = { locationId, page, search, ...(view === 'valuation' ? { date: asOf } : {}), ...(view === 'ledger' ? { kind, month: ledgerMonth } : {}) };
  const balances = useScopedQuery<Page<{ products: Balance[]; activatedAt: string | null }>>(['inventory-costs', 'balances', params],
    async signal => (await api.get(endpoint + (view === 'valuation' ? '/valuation' : '/balances'), { params, signal })).data.data, !!locationId && (view === 'balances' || (view === 'valuation' && /^\d{4}-\d{2}-\d{2}$/.test(asOf))), 30000, { paused: editing });
  const entries = useScopedQuery<Page<{ records: Entry[] }>>(['inventory-costs', view, params],
    async signal => (await api.get(endpoint + '/entries', { params: { ...params, missing: view === 'missing' }, signal })).data.data,
    !!locationId && ['ledger', 'missing'].includes(view), 30000, { paused: editing });
  const [year, monthNumber] = month.split('-').map(Number);
  const reconciliation = useScopedQuery<Reconciliation>(['inventory-costs', 'reconciliation', locationId, month], async signal =>
    (await api.get(endpoint + '/reconciliation', { signal, params: { locationId, startDate: month + '-01',
      endDate: month + '-' + new Date(Date.UTC(year, monthNumber, 0)).getUTCDate() } })).data.data,
  !!locationId && view === 'reconciliation' && /^\d{4}-\d{2}$/.test(month), 30000, { paused: editing });
  const query = ['balances','valuation'].includes(view) ? balances : view === 'reconciliation' ? reconciliation : entries;
  const pagination = ['balances','valuation'].includes(view) ? balances.data?.pagination : entries.data?.pagination;
  const resetForm = () => { setError(''); setReason(''); setPreview(null); };
  const close = () => { if (!busy) { setOpening(null); setSelected(null); setPreview(null); } };
  const save = async () => {
    setBusy(true); setError('');
    try {
      if (opening) await operation.submit({ label: 'Opening inventory: ' + opening.name, path: endpoint + '/opening', payload: { notes: reason,
        items: [{ productId: opening.id, quantity: Number(quantity), value: Number(value), expectedVersion: opening.stockVersion }] } });
      else if (selected && action === 'return') await operation.submit({ label: 'Supplier return: ' + selected.productName, path: endpoint + '/supplier-returns', payload: { receiptEntryId: selected.id, quantity: Number(quantity),
        creditAmount: Number(value), reason } });
      else if (selected && action === 'correction') {
        const body = { entryId: selected.id, value: Number(value), reason };
        if (!preview) { setPreview((await api.post(endpoint + '/corrections/preview', body)).data.data); return; }
        await operation.submit({ label: 'Cost correction: ' + selected.productName, path: endpoint + '/corrections', payload: { ...body, token: preview.token } });
      }
    } catch (e) { setError(errorText(e)); setPreview(null); } finally { setBusy(false); }
  };
  if (!locationId) return <p className="text-sm text-muted-foreground">Select a store to review inventory costs.</p>;
  return <div className="space-y-4">
    {(operation.pending || operation.error) && <div role="alert" className="rounded-lg border p-3 text-sm space-y-2"><p>{operation.error || 'Confirm the saved inventory operation before recording another.'}</p>{operation.pending && <p>{operation.pending.label}</p>}<Button variant="outline" disabled={operation.busy} onClick={() => void operation.retry()}>Retry saved operation</Button></div>}
    <PageTabs secondary label="Inventory cost views" value={view} onChange={setTab} items={[
      { id: 'balances', label: 'Balances & Opening' }, { id: 'valuation', label: 'Value by Date' }, { id: 'missing', label: 'Missing Costs' }, { id: 'ledger', label: 'Value Ledger' }, { id: 'reconciliation', label: 'Monthly Summary' },
    ]} />
    {view === 'balances' && <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="w-full sm:max-w-sm"><Input aria-label="Search inventory costs" placeholder="Search products or SKU" value={search} maxLength={200} onChange={e => setSearch(e.target.value)} /></div>
        {owner && !readOnly && <Button disabled={operation.blocked} onClick={() => setBulkOpening(true)}>Review opening inventory</Button>}
      </div>
      <p className="text-sm text-muted-foreground">Opening inventory is a one-time setup for existing stock. Balances carry forward automatically each month.</p>
    </div>}
    {view === 'reconciliation' && <><p className="text-sm text-muted-foreground">Opening value, what changed, and closing value for a month.</p><label className="flex items-center gap-2 text-sm">Month<Input type="month" aria-label="Monthly summary month" value={month} onChange={e => setMonth(e.target.value)} className="w-44" /></label></>}
    {view === 'valuation' && <label className="flex items-center gap-2 text-sm"><span className="whitespace-nowrap">As of</span><Input type="date" aria-label="Inventory valuation date" value={asOf} onChange={e => setAsOf(e.target.value)} className="w-44" /></label>}
    {view === 'ledger' && kind && <div className="flex flex-wrap items-center gap-3 text-sm"><span>{label(kind)} · {ledgerMonth}</span><Button variant="outline" onClick={() => linkMovements()}>All records</Button></div>}
    {view === 'ledger' && <p className="text-sm text-muted-foreground">Cost history for receipts, sales, returns and adjustments. Use it to trace inventory value and investigate profit differences.</p>}
    {query.error && <Alert tone="error" title={query.error} action={<Button variant="outline" onClick={() => void query.refresh()}>Retry</Button>} />}
    {query.loading ? <LoadingState label="Loading inventory costs…" /> : <>
      {['balances','valuation'].includes(view) && balances.data && <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow>
        <TableHead>Product</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Latest supplier price</TableHead><TableHead className="text-right">Average cost</TableHead><TableHead className="text-right">Inventory value</TableHead><TableHead>Opening review</TableHead>
      </TableRow></TableHeader><TableBody>{balances.data.products.map(product => <TableRow key={product.id}>
        <TableCell><span className="font-medium">{product.name}</span><div className="text-xs text-muted-foreground">{product.sku}</div></TableCell>
        <TableCell className="text-right tabular-nums">{product.quantity ?? 'Unavailable'}</TableCell><TableCell className="text-right tabular-nums">{money(product.supplierPrice)}</TableCell><TableCell className="text-right tabular-nums">{money(product.averageCost)}</TableCell><TableCell className="text-right tabular-nums">{money(product.value)}</TableCell>
        <TableCell>{view === 'valuation' ? 'Historical valuation' : product.openingConfirmed ? 'Confirmed' : product.quantity === 0 ? 'No stock to value' : product.value !== null ? 'Cost recorded' : owner && !readOnly ? <Button variant="outline" disabled={operation.blocked} onClick={() => { resetForm(); setOpening(product); setQuantity(String(product.quantity)); setValue(product.supplierPrice > 0 ? String(Number((product.quantity * product.supplierPrice).toFixed(2))) : ''); }}>Review opening</Button> : 'Owner confirmation required'}</TableCell>
      </TableRow>)}{!balances.data.products.length && <TableRow><TableCell colSpan={6}>No tracked products found.</TableCell></TableRow>}</TableBody></Table></div>}
      {['missing', 'ledger'].includes(view) && entries.data && <>
        {view === 'missing' && <p className="text-sm text-muted-foreground">Confirm documented costs. Imported daily summaries have no item costs and remain unavailable.</p>}
        <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead>Movement</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Value change</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>
          {entries.data.records.map(entry => <TableRow key={entry.id}><TableCell>{formatDate(entry.createdAt, timezone)}</TableCell><TableCell>{entry.productName}<div className="text-xs text-muted-foreground">{entry.sku}</div></TableCell>
            <TableCell>{label(entry.kind)}</TableCell><TableCell className="text-right tabular-nums">{entry.quantity}</TableCell><TableCell className="text-right tabular-nums">{money(entry.valueChange)}</TableCell><TableCell><div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { resetForm(); setSelected(entry); setAction('details'); }}>Details</Button>
              {owner && (['OPENING','BASELINE','PURCHASE','SALE','OFFLINE_SALE'].includes(entry.kind) || (entry.quantity > 0 && ['ADJUSTMENT','IMPORT'].includes(entry.kind))) && (!['SALE','OFFLINE_SALE'].includes(entry.kind) || entry.cogsAmount === null) && <Button variant="outline" onClick={() => { resetForm(); setSelected(entry); setAction('correction'); setValue(''); }}>Review cost</Button>}
              {!readOnly && entry.kind === 'PURCHASE' && <Button variant="outline" onClick={() => { resetForm(); setSelected(entry); setAction('return'); setQuantity(''); setValue(''); }}>Supplier return</Button>}
            </div></TableCell></TableRow>)}
          {!entries.data.records.length && <TableRow><TableCell colSpan={6}>{view === 'missing' ? 'No unresolved inventory cost records.' : 'No inventory value entries yet.'}</TableCell></TableRow>}
        </TableBody></Table></div>
      </>}
      {view === 'reconciliation' && reconciliation.data && <div className="rounded-lg border p-4 space-y-3">
        <p className="text-sm text-muted-foreground">{reconciliation.data.complete ? 'Every change is accounted for' : 'Cost information incomplete'}</p>
        <div className="flex justify-between font-medium"><span>Opening inventory</span><span>{money(reconciliation.data.opening.value)}</span></div>
        {reconciliation.data.movements.map(row => <div className="flex justify-between gap-4 text-sm" key={row.kind}><button className="text-left text-primary underline underline-offset-4" onClick={() => linkMovements(row.kind)}>{label(row.kind)} · {row.entries} records</button><span>{money(row.value)}</span></div>)}
        <div className="flex justify-between border-t pt-3 font-medium"><span>Closing inventory</span><span>{money(reconciliation.data.closing.value)}</span></div>
        <div className="flex justify-between text-sm"><span>In transit · {reconciliation.data.inTransit.quantity} units</span><span>{money(reconciliation.data.inTransit.value)}</span></div>
      </div>}
      {view !== 'reconciliation' && pagination && pagination.totalPages > 1 && <Pagination page={page} totalPages={pagination.totalPages} onPageChange={setPage} totalItems={pagination.total} itemName="records" />}
    </>}
    {bulkOpening && <OpeningInventoryReview key={locationId} locationId={locationId} search={search} busy={operation.busy} blocked={operation.blocked}
      error={operation.error} pending={!!operation.pending} onClose={() => setBulkOpening(false)} onRetry={operation.retry}
      onSubmit={payload => operation.submit({ label: `Opening inventory: ${payload.items.length} products`, path: endpoint + '/opening', payload })} />}
    <Modal isOpen={!!opening || !!selected} onClose={close} size={preview ? 'xl' : 'lg'} title={opening ? 'Confirm opening inventory' : action === 'return' ? 'Supplier return & credit' : action === 'correction' ? 'Review cost correction' : 'Inventory value record'}
      footer={<div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={close} disabled={busy || operation.busy}>Close</Button>{(opening || action !== 'details') && <Button onClick={() => void save()} disabled={busy || operation.blocked || !value.trim() || reason.trim().length < 3 || ((!!opening || action === 'return') && !quantity.trim())}>
        {busy ? 'Saving…' : opening ? 'Confirm opening value' : action === 'return' ? 'Record supplier return' : preview ? 'Confirm correction' : 'Preview correction'}</Button>}</div>}>
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
      {operation.error && <p role="alert" className="mb-4 text-sm text-destructive">{operation.error}</p>}
      {operation.pending && <Button variant="outline" disabled={operation.busy} onClick={() => void operation.retry()}>Retry saved operation</Button>}
      <div className="space-y-4">
        <p className="font-medium">{opening?.name || selected?.productName}</p>
        {opening && <p className="text-sm text-muted-foreground">Review the physical quantity and total value at cost. The suggested value uses the latest supplier price and requires your confirmation. This opening does not assign costs to earlier sales.</p>}
        {selected && action === 'details' ? <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt>Movement</dt><dd>{label(selected.kind)}</dd><dt>Units</dt><dd>{selected.quantity}</dd><dt>Value change</dt><dd>{money(selected.valueChange)}</dd>
          <dt>Closing value</dt><dd>{money(selected.valueAfter)}</dd><dt>Recorded COGS</dt><dd>{money(selected.cogsAmount)}</dd><dt>Source record</dt><dd className="break-all">{selected.sourceId}</dd><dt>Notes</dt><dd>{selected.notes || '—'}</dd>
        </dl> : <>
          {(opening || action === 'return') && <Input label={opening ? 'Confirmed quantity' : 'Units physically returned'} type="number" min={opening ? 0 : 1} step="1" value={quantity} onChange={e => setQuantity(e.target.value)} />}
          <Input label={action === 'return' && !opening ? 'Supplier credit amount' : opening ? 'Total inventory value at cost' : 'Corrected total cost'} type="number" min="0" step="0.00000001" value={value} onChange={e => { setValue(e.target.value); setPreview(null); }} />
          <Input label={opening ? 'Opening inventory evidence' : 'Reason / supporting document'} value={reason} maxLength={2000} onChange={e => { setReason(e.target.value); setPreview(null); }} placeholder="Invoice, count sheet or other verified record" />
          <p className="text-xs text-muted-foreground">A confirmed cost of zero means the goods were free. Leave missing costs unresolved until supporting records are available.</p>
          {action === 'return' && <p className="text-xs text-muted-foreground">For a price credit without returned goods, use Review cost on the original receipt and preview its revised total cost.</p>}
          {preview && <><p className="text-sm">{preview.explanation}</p><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Movement</TableHead><TableHead>Previous COGS</TableHead><TableHead>Corrected COGS</TableHead><TableHead>Previous inventory</TableHead><TableHead>Corrected inventory</TableHead></TableRow></TableHeader><TableBody>
            {preview.changes.map(row => <TableRow key={row.entryId}><TableCell>{label(row.kind)}</TableCell><TableCell>{money(row.previousCogs)}</TableCell><TableCell>{money(row.cogsAmount)}</TableCell><TableCell>{money(row.previousValue)}</TableCell><TableCell>{money(row.valueAfter)}</TableCell></TableRow>)}
          </TableBody></Table></div></>}
        </>}
      </div>
    </Modal>
  </div>;
}
