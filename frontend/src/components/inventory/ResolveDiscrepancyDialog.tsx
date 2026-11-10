import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ProductPicker } from '@/components/common/ProductPicker';
import { inventoryExceptionService } from '@/services/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';

/** What the manager says happened; each maps to one accounting treatment. */
type Cause = 'sold_as_other' | 'missing_receipt' | 'received_as_other' | 'transfer' | 'count' | 'loss' | 'no_change';
const CAUSES: { id: Cause; label: string; hint: string }[] = [
  { id: 'sold_as_other', label: 'Another product was rung up instead', hint: 'The customer took a different item. Its stock goes down and this one is corrected; the sale keeps the cost of what actually left.' },
  { id: 'missing_receipt', label: "A delivery wasn't entered", hint: 'The units were bought but never received in the system. Cost of goods is not reduced; the stock is listed so you can enter the supplier cost later.' },
  { id: 'received_as_other', label: 'A delivery was entered under another product', hint: 'Moves the units, with their real received cost, from the product they were entered under.' },
  { id: 'transfer', label: "A transfer from another store wasn't recorded", hint: 'Treated like a delivery that was not entered.' },
  { id: 'count', label: "I counted it / I'm not sure why", hint: 'Sets stock to your count. Units that cover the shortfall keep their sale cost; only units above zero count as found stock.' },
  { id: 'loss', label: 'Fewer on the shelf: damaged, expired, stolen or sold without scanning', hint: 'Records the missing units with that reason.' },
  { id: 'no_change', label: 'Reviewed, no change needed', hint: 'Closes the alert without changing stock.' },
];
const LOSS_REASONS = [
  ['DAMAGED', 'Damaged'], ['EXPIRED', 'Expired'], ['THEFT', 'Stolen'], ['SOLD_WITHOUT_SCANNING', 'Sold without scanning (misc key)'],
] as const;

export interface DiscrepancyDetail {
  id: string;
  currentQuantity: number;
  product: { id: string; name: string; stockVersion: number };
  relatedProducts: { id: string; name: string; sku: string; stockQuantity: number; reasons: string[] }[];
  recentSales: { id: string; quantity: number; createdAt: string; sale: { saleNumber: string; user?: { firstName: string; lastName: string } | null } }[];
}
interface Preview {
  changes: { productId: string; name: string; from: number; to: number }[];
  cogsChange: number | string | null;
  unmatchedValue: number | string | null;
  priceDifference?: number | string | null;
}

const num = (v: number | string | null | undefined) => v === null || v === undefined ? null : Number(v);

export const ResolveDiscrepancyDialog: React.FC<{ detail: DiscrepancyDetail | null; locationId: string; onClose: () => void; onDone: () => void }> = ({ detail, locationId, onClose, onDone }) => {
  const [cause, setCause] = useState<Cause>('sold_as_other');
  const [other, setOther] = useState<{ id: string; name: string } | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [counted, setCounted] = useState('');
  const [lossReason, setLossReason] = useState<string>('DAMAGED');
  const [saleItemId, setSaleItemId] = useState('');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!detail) return;
    setCause('sold_as_other'); setOther(null); setSaleItemId(''); setNotes(''); setPreview(null); setRequestKey(crypto.randomUUID());
    setQuantity(String(Math.max(1, -detail.currentQuantity))); setCounted('');
  }, [detail]);

  const isReclass = cause === 'sold_as_other' || cause === 'received_as_other';
  const isCount = cause === 'missing_receipt' || cause === 'transfer' || cause === 'count' || cause === 'loss';
  const resolution = cause === 'missing_receipt' ? 'MISSING_RECEIPT' : cause === 'transfer' ? 'TRANSFER_NOT_RECORDED' : cause === 'loss' ? lossReason : 'MISCOUNT';
  const qty = Number(quantity), countedQty = Number(counted);
  const request = useMemo(() => {
    if (!detail) return null;
    if (isReclass) return other && Number.isSafeInteger(qty) && qty > 0 ? { action: 'reclass' as const, fromProductId: other.id, quantity: qty } : null;
    if (isCount) return counted !== '' && Number.isSafeInteger(countedQty) && countedQty >= 0 ? { action: 'count' as const, countedQuantity: countedQty, resolution } : null;
    return null;
  }, [detail, isReclass, isCount, other, qty, counted, countedQty, resolution]);

  // Show the stock and P&L effect before anything is saved.
  useEffect(() => {
    if (!detail || !request) { setPreview(null); setPreviewError(null); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      inventoryExceptionService.preview(detail.id, request)
        .then(res => { if (active) { setPreview(res.data.data); setPreviewError(null); } })
        .catch(err => { if (active) { setPreview(null); setPreviewError(err.response?.data?.error || 'Could not calculate the effect'); } });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [detail, request]);

  if (!detail) return null;
  const lossTooHigh = cause === 'loss' && counted !== '' && countedQty >= detail.currentQuantity;

  const save = async () => {
    setSaving(true);
    try {
      if (cause === 'no_change') {
        await inventoryExceptionService.resolve(detail.id, { resolution: 'NO_CHANGE_NEEDED', notes: notes.trim() || undefined });
      } else if (isReclass) {
        if (!request) { toast.error('Choose the product and quantity'); setSaving(false); return; }
        await inventoryExceptionService.reclass(detail.id, { fromProductId: other!.id, quantity: qty, idempotencyKey: requestKey,
          reason: cause === 'sold_as_other' ? 'SOLD_AS_OTHER' : 'RECEIVED_AS_OTHER', saleItemId: saleItemId || undefined, notes: notes.trim() || undefined });
      } else {
        if (!request) { toast.error('Enter the number on the shelf'); setSaving(false); return; }
        await inventoryExceptionService.recordCount(detail.id, { countedQuantity: countedQty, resolution, notes: notes.trim() || undefined,
          expectedVersion: detail.product.stockVersion, idempotencyKey: requestKey });
      }
      toast.success('Discrepancy resolved');
      onDone();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  };

  const cogs = num(preview?.cogsChange), unmatched = num(preview?.unmatchedValue), price = num(preview?.priceDifference);
  return (
    <Modal isOpen={!!detail} onClose={onClose} title={`Resolve discrepancy: ${detail.product.name}`} size="lg"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving || lossTooHigh || (cause !== 'no_change' && !request)}>{saving ? 'Saving…' : 'Save'}</Button></div>}>
      <div className="space-y-4 text-sm">
        <fieldset className="space-y-2">
          <legend className="mb-1 font-semibold">What happened?</legend>
          {CAUSES.map(option => (
            <label key={option.id} className={`flex cursor-pointer gap-3 rounded-md border p-3 ${cause === option.id ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <input type="radio" name="cause" value={option.id} checked={cause === option.id} onChange={() => { setCause(option.id); setPreview(null); }} className="mt-1" />
              <span><span className="font-medium">{option.label}</span><span className="block text-xs text-muted-foreground">{option.hint}</span></span>
            </label>
          ))}
        </fieldset>

        {isReclass && <section className="space-y-3">
          <p className="font-medium">{cause === 'sold_as_other' ? 'Which product did the customer actually take?' : 'Which product was the delivery entered under?'}</p>
          {other ? <div className="flex items-center justify-between rounded-md border border-primary p-3"><span className="font-medium">{other.name}</span>
            <Button size="sm" variant="outline" onClick={() => setOther(null)}>Change</Button></div> : <>
            {detail.relatedProducts.length > 0 && <div className="flex flex-wrap gap-2">
              {detail.relatedProducts.slice(0, 6).map(p => <Button key={p.id} size="sm" variant="outline" onClick={() => setOther({ id: p.id, name: p.name })} title={p.reasons.join(' · ')}>{p.name}</Button>)}
            </div>}
            <ProductPicker locationId={locationId} selectedIds={[detail.product.id]} onSelect={p => setOther({ id: p.id, name: p.name })} />
          </>}
          <Input type="number" label="Units" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
          {cause === 'sold_as_other' && detail.recentSales.length > 0 && (
            <Select label="Which sale? (optional — records it against the cashier's sale)" value={saleItemId} onChange={e => setSaleItemId(e.target.value)}>
              <option value="">Not sure</option>
              {detail.recentSales.map(line => <option key={line.id} value={line.id}>
                {line.sale.saleNumber}{line.sale.user ? ` · ${line.sale.user.firstName} ${line.sale.user.lastName}` : ''} · {line.quantity} unit(s) · {formatDateTime(line.createdAt)}
              </option>)}
            </Select>)}
        </section>}

        {isCount && <section className="space-y-3">
          {cause === 'loss' && <Select label="Reason" value={lossReason} onChange={e => setLossReason(e.target.value)}>
            {LOSS_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>}
          <Input type="number" label={`How many ${detail.product.name} are on the shelf?`} min="0" step="1" value={counted} onChange={e => setCounted(e.target.value)} />
          {lossTooHigh && <p role="alert" className="text-destructive">For a loss, the shelf count must be lower than the recorded {detail.currentQuantity}.</p>}
        </section>}

        <Input label="Notes" description="Optional" value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} />

        {preview && <section aria-label="Effect of this change" className="rounded-md border border-border bg-muted/40 p-3 space-y-1">
          <p className="font-semibold">What this will change</p>
          {preview.changes.map(change => <p key={change.productId}>{change.name}: {change.from} → {change.to}</p>)}
          <p>Cost of goods: {cogs === null ? 'unknown' : cogs === 0 ? 'no change (the sale keeps its cost)' : `${cogs > 0 ? '+' : '−'}${formatCurrency(Math.abs(cogs))}`}</p>
          {unmatched !== null && unmatched > 0 && <p>Recorded as received without an invoice: {formatCurrency(unmatched)} (enter the supplier cost later under “Added without invoice”)</p>}
          {cause === 'sold_as_other' && price !== null && price !== 0 && <p>{price > 0 ? `Customer was under-charged ${formatCurrency(price)}` : `Customer was over-charged ${formatCurrency(-price)}`} — the receipt itself is not changed.</p>}
        </section>}
        {previewError && <p role="alert" className="text-destructive">{previewError}</p>}
      </div>
    </Modal>
  );
};
