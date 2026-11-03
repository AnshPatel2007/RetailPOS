import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/Table';

type Product = { id: string; name: string; sku: string; quantity: number; stockVersion: number; supplierPrice: number };
type Draft = Product & { included: boolean; confirmedQuantity: string; confirmedValue: string };
type OpeningPayload = { notes: string; items: { productId: string; quantity: number; value: number; expectedVersion: number }[] };
type Props = {
  locationId: string;
  search: string;
  busy: boolean;
  blocked: boolean;
  error: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: OpeningPayload) => Promise<unknown>;
  onRetry: () => Promise<unknown>;
};
const pageSize = 25;
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
function quantityError(row: Draft) {
  const number = Number(row.confirmedQuantity);
  return !row.confirmedQuantity.trim() || !Number.isInteger(number) || number < 0 || number > 2147483647
    ? 'Enter a whole quantity of 0 or more.' : undefined;
}
function valueError(row: Draft) {
  const number = Number(row.confirmedValue);
  if (!row.confirmedValue.trim()) return 'Enter a documented value or exclude this product.';
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000_000) return 'Enter a valid value of 0 or more.';
  return Number(row.confirmedQuantity) === 0 && number !== 0 ? 'Empty inventory must have zero value.' : undefined;
}

export function OpeningInventoryReview({ locationId, search, busy, blocked, error, pending, onClose, onSubmit, onRetry }: Props) {
  // Load a fresh snapshot only when this review opens. Never replace an owner's draft during review.
  const query = useScopedQuery<{ products: Product[]; total: number }>(['inventory-opening-review', locationId, search], async signal =>
    (await api.get('/financial/inventory-costs/opening-review', { params: { locationId, search }, signal })).data.data,
  true, 0, { autoRefresh: false });
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [page, setPage] = useState(1), [notes, setNotes] = useState(''), [verified, setVerified] = useState(false);
  useEffect(() => {
    if (query.data && rows === null) setRows(query.data.products.map(product => ({ ...product, included: true,
      confirmedQuantity: String(product.quantity),
      // A catalog price of zero is not evidence that these goods were free.
      confirmedValue: product.supplierPrice > 0 ? String(Number((product.quantity * product.supplierPrice).toFixed(2))) : '',
    })));
  }, [query.data, rows]);
  const selected = rows?.filter(row => row.included) || [];
  const invalid = selected.filter(row => quantityError(row) || valueError(row));
  const visible = rows?.slice((page - 1) * pageSize, page * pageSize) || [];
  const pages = Math.ceil((rows?.length || 0) / pageSize);
  const change = (id: string, update: Partial<Draft>) => {
    setRows(current => current?.map(row => row.id === id ? { ...row, ...update } : row) || null); setVerified(false);
  };
  const save = async () => {
    if (!verified || !selected.length || invalid.length || notes.trim().length < 3 || blocked) return;
    await onSubmit({ notes: notes.trim(), items: selected.map(row => ({ productId: row.id, quantity: Number(row.confirmedQuantity),
      value: Number(row.confirmedValue), expectedVersion: row.stockVersion })) });
  };
  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} title="Review opening inventory" size="xl"
    footer={<div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm tabular-nums">{selected.length} selected · {invalid.length ? `${invalid.length} need attention` : money(selected.reduce((total, row) => total + Number(row.confirmedValue), 0))}</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button disabled={blocked || !verified || !selected.length || !!invalid.length || notes.trim().length < 3} onClick={() => void save()}>
          {busy ? 'Saving…' : `Confirm ${selected.length} products`}
        </Button></div>
    </div>}>
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Set the starting quantity and total value at cost once. Suggested values use the latest supplier price; check them against your records. Earlier sales are unchanged.</p>
      {search && <p className="text-sm">Products matching “{search}”</p>}
      {query.error && <div role="alert" className="text-sm space-y-2"><p>{query.error}</p><Button variant="outline" onClick={() => void query.refresh()}>Retry</Button></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {pending && <Button variant="outline" disabled={busy} onClick={() => void onRetry()}>Retry saved operation</Button>}
      {query.loading && !rows && <p role="status" className="text-sm">Loading products for review…</p>}
      {rows?.length === 0 && <p className="text-sm">No opening values need review{search ? ' for these products' : ''}. Existing confirmed values, stock with recorded costs, and empty inventory are excluded.</p>}
      {!!rows?.length && <fieldset disabled={blocked} className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <label className="inline-flex min-h-11 sm:min-h-9 items-center gap-2 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.length === rows.length}
              ref={input => { if (input) input.indeterminate = selected.length > 0 && selected.length < rows.length; }}
              onChange={e => { const included = e.target.checked; setRows(current => current?.map(row => ({ ...row, included })) || null); setVerified(false); }} />
            Include all {rows.length} products
          </label>
          <span>{query.data?.total ?? rows.length} awaiting opening review</span>
        </div>
        {(query.data?.total || 0) > rows.length && <p className="text-sm text-muted-foreground">Showing the first {rows.length} products. Confirm this group, then reopen to review the next group. Use product search to narrow the list.</p>}
        <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow>
          <TableHead>Include</TableHead><TableHead>Product</TableHead><TableHead>Quantity</TableHead><TableHead>Total value at cost</TableHead>
        </TableRow></TableHeader><TableBody>{visible.map(row => <TableRow key={row.id}>
          <TableCell><label className="inline-flex min-h-11 sm:min-h-9 min-w-9 items-center justify-center"><input type="checkbox" className="h-4 w-4 accent-primary"
            aria-label={`Include ${row.name}`} checked={row.included} onChange={e => change(row.id, { included: e.target.checked })} /></label></TableCell>
          <TableCell className="min-w-40"><span className="font-medium">{row.name}</span><p className="text-xs text-muted-foreground">{row.sku}</p>
            <p className="text-xs text-muted-foreground">Supplier price {money(row.supplierPrice)}</p></TableCell>
          <TableCell className="min-w-28"><Input aria-label={`Quantity for ${row.name}`} type="number" min="0" step="1" value={row.confirmedQuantity}
            disabled={!row.included} error={row.included ? quantityError(row) : undefined} onChange={e => change(row.id, { confirmedQuantity: e.target.value })} /></TableCell>
          <TableCell className="min-w-44"><Input aria-label={`Inventory value for ${row.name}`} type="number" min="0" step="0.00000001" value={row.confirmedValue}
            disabled={!row.included} error={row.included ? valueError(row) : undefined} onChange={e => change(row.id, { confirmedValue: e.target.value })} /></TableCell>
        </TableRow>)}</TableBody></Table></div>
        {pages > 1 && <div className="flex items-center justify-end gap-3 text-sm">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous products</Button><span>Page {page} of {pages}</span>
          <Button variant="outline" disabled={page === pages} onClick={() => setPage(page + 1)}>Next products</Button>
        </div>}
        <p className="text-xs text-muted-foreground">Exclude products whose costs are unknown. Enter zero only for documented free goods. Changing a quantity does not change its total value automatically.</p>
        <Input label="Opening inventory evidence" value={notes} maxLength={2000} placeholder="Invoice, count sheet or other verified record"
          onChange={e => { setNotes(e.target.value); setVerified(false); }} />
        <label className="flex min-h-11 items-center gap-3 text-sm cursor-pointer"><input type="checkbox" className="h-4 w-4 shrink-0 accent-primary"
          checked={verified} onChange={e => setVerified(e.target.checked)} />I verified the selected quantities and values against the supporting records.</label>
      </fieldset>}
    </div>
  </Modal>;
}
