import { useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { purchaseOrderService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { outstandingQuantity, PurchaseOrder, PurchaseReceiptRequest } from '@/types/purchasing';

interface Props { order: PurchaseOrder; onClose: () => void; onSaved: () => void }

// Keep an uncertain request intact across closing/reloading so a dropped response cannot duplicate stock.
export function PurchaseReceiptModal({ order, onClose, onSaved }: Props) {
  const userId = useAuthStore(s => s.user?.id);
  const storageKey = `pos-purchase-receipt:${order.locationId}:${userId}:${order.id}`;
  const [pending, setPending] = useState<PurchaseReceiptRequest | null>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
  });
  const [lines, setLines] = useState(() => (order.items || []).map(item => {
    const saved = pending?.receivedItems.find(line => line.purchaseOrderItemId === item.id);
    // Prefill from how it was ordered: case size and the price of one case.
    const packSize = saved?.packSize ?? item.packSize ?? 1;
    const casePrice = item.packCost != null ? Number(item.packCost) : Math.round(Number(item.cost) * packSize * 10000) / 10000;
    const sealedUnit = (item.sellingUnits || []).find(unit => unit.unitsPerPackage === packSize);
    return { purchaseOrderItemId: item.id, quantity: String(saved?.quantity ?? outstandingQuantity(item)), damagedQty: String(saved?.damagedQty ?? 0), rejectedQty: String(saved?.rejectedQty ?? 0),
      unitCost: String(saved?.unitCost ?? casePrice), packSize: String(packSize), lineDiscount: String(saved?.lineDiscount ?? 0), zeroCostConfirmed: saved?.zeroCostConfirmed ?? false,
      sealedUnitId: saved ? saved.sellingUnitId ?? '' : sealedUnit?.id ?? '' };
  }));
  const [invoiceNumber, setInvoiceNumber] = useState(pending?.invoiceNumber || ''), [invoiceDate, setInvoiceDate] = useState(pending?.invoiceDate?.slice(0, 10) || '');
  const [charges, setCharges] = useState({ freight: String(pending?.freight || 0), acquisitionTax: String(pending?.acquisitionTax || 0), invoiceDiscount: String(pending?.invoiceDiscount || 0) });
  const [notes, setNotes] = useState(pending?.notes || '');
  const [finalDelivery, setFinalDelivery] = useState(pending?.finalDelivery || false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const totalRemaining = (order.items || []).reduce((sum, item) => sum + outstandingQuantity(item), 0);
  const counted = lines.reduce((sum, line) => sum + Number(line.quantity) + Number(line.damagedQty) + Number(line.rejectedQty), 0);
  const missing = Math.max(0, totalRemaining - counted);

  const save = async () => {
    if (submitting.current) return;
    setError('');
    let payload = pending;
    if (!payload) {
      const receivedItems = lines.map(line => {
        const packSize = Number(line.packSize), quantity = Number(line.quantity);
        // Unopened cases that match a store pack are received as sealed packs.
        const sealed = line.sealedUnitId && packSize > 1 && quantity > 0 && quantity % packSize === 0;
        return { purchaseOrderItemId: line.purchaseOrderItemId, quantity, damagedQty: Number(line.damagedQty), rejectedQty: Number(line.rejectedQty),
          unitCost: Number(line.unitCost), packSize, lineDiscount: Number(line.lineDiscount), zeroCostConfirmed: line.zeroCostConfirmed,
          ...(sealed ? { sellingUnitId: line.sealedUnitId, packQuantity: quantity / packSize } : {}) };
      });
      if (receivedItems.some((line, index) => [line.quantity, line.damagedQty, line.rejectedQty].some(n => !Number.isSafeInteger(n) || n < 0) || line.quantity + line.damagedQty + line.rejectedQty > outstandingQuantity(order.items![index]))) {
        setError('Use whole, non-negative quantities that do not exceed the remaining units for each item.'); return;
      }
      if (!counted && !finalDelivery) { setError('Enter at least one delivered unit, or close the remaining order with a reason.'); return; }
      if ((receivedItems.some(line => line.damagedQty || line.rejectedQty) || (finalDelivery && missing > 0)) && !notes.trim()) {
        setError('Add a reason for damaged, rejected or missing items.'); return;
      }
      if (lines.some(line => !line.unitCost.trim() || !Number.isFinite(Number(line.unitCost)) || Number(line.unitCost) < 0 || !Number.isInteger(Number(line.packSize)) || Number(line.packSize) < 1)) {
        setError('Enter the actual purchase price and units per pack. Confirm 0 only for free goods.'); return;
      }
      payload = { idempotencyKey: crypto.randomUUID(), receivedItems, notes: notes.trim(), finalDelivery,
        invoiceNumber: invoiceNumber.trim() || undefined, invoiceDate: invoiceDate ? invoiceDate + 'T12:00:00.000Z' : undefined,
        freight: Number(charges.freight), acquisitionTax: Number(charges.acquisitionTax), invoiceDiscount: Number(charges.invoiceDiscount) };
      try { localStorage.setItem(storageKey, JSON.stringify(payload)); }
      catch { setError('This browser cannot preserve a safe retry. Allow local storage before recording the delivery.'); return; }
      setPending(payload);
    }
    submitting.current = true; setSaving(true);
    try {
      await purchaseOrderService.receive(order.id, payload);
      try { localStorage.removeItem(storageKey); } catch { /* A retained key can only replay this same receipt. */ }
      onSaved();
    } catch (failure: unknown) {
      const response = (failure as { response?: { status: number; data?: { error?: string } } }).response;
      if (response && [400, 404, 409].includes(response.status)) {
        try { localStorage.removeItem(storageKey); } catch { /* No transaction committed. */ }
        setPending(null);
      }
      setError(response?.data?.error || 'The delivery result is uncertain. Retry this same delivery to check it safely.');
    } finally { submitting.current = false; setSaving(false); }
  };

  return <Modal isOpen onClose={() => { if (!saving) onClose(); }} title={`Receive delivery · ${order.orderNumber}`} size="xl">
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Only accepted units increase available stock. Damaged and rejected units count toward the delivery but are kept out of inventory. Record replacement units on a new order.</p>
      {pending && <p role="status" className="rounded-lg border p-3 text-sm">A delivery is awaiting confirmation. Retry the saved quantities before starting another delivery.</p>}
      {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p>}
      <fieldset disabled={saving || !!pending} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2"><Input label="Invoice number" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /><Input label="Invoice date" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
        {(order.items || []).map((item, index) => <div key={item.id} className="rounded-lg border p-3 space-y-3">
          <div className="flex flex-wrap justify-between gap-2"><div><p className="font-medium">{item.productName}</p><p className="text-xs text-muted-foreground">{item.sku}</p></div><p className="text-sm tabular-nums">{outstandingQuantity(item)} remaining of {item.quantity} ordered</p></div>
          <div className="grid grid-cols-3 gap-3">
            {(['quantity', 'damagedQty', 'rejectedQty'] as const).map((field, fieldIndex) => <Input key={field} label={['Accepted', 'Damaged', 'Rejected'][fieldIndex]} aria-label={`${item.productName} ${['accepted', 'damaged', 'rejected'][fieldIndex]}`} type="number" inputMode="numeric" min={0} max={outstandingQuantity(item)} step={1} value={lines[index][field]} onChange={e => setLines(previous => previous.map((line, i) => i === index ? { ...line, [field]: e.target.value } : line))} />)}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(['unitCost', 'packSize', 'lineDiscount'] as const).map((field, fieldIndex) => <Input key={field} label={['Purchase price per pack', 'Units per pack', 'Line discount (accepted goods)'][fieldIndex]}
              aria-label={`${item.productName} ${field}`} type="number" min={field === 'packSize' ? 1 : 0} step={field === 'packSize' ? 1 : '0.0001'} value={lines[index][field]}
              onChange={e => setLines(previous => previous.map((line, i) => i === index ? { ...line, [field]: e.target.value } : line))} />)}
          </div>
          <p className="text-xs text-muted-foreground">Accepted quantity is single units. {Number(lines[index].packSize) > 1
            ? `${Number(lines[index].quantity) / Number(lines[index].packSize)} case(s) of ${lines[index].packSize} at ${lines[index].unitCost} per case = ${(Number(lines[index].unitCost) / Number(lines[index].packSize)).toFixed(4)} per unit.`
            : `${lines[index].unitCost} per unit.`}</p>
          {(item.sellingUnits || []).some(unit => unit.unitsPerPackage === Number(lines[index].packSize)) && <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={!!lines[index].sealedUnitId} onChange={e => setLines(previous => previous.map((line, i) => i === index
              ? { ...line, sealedUnitId: e.target.checked ? item.sellingUnits!.find(unit => unit.unitsPerPackage === Number(line.packSize))!.id : '' } : line))} />
            Cases arrived unopened — count them as sealed {item.sellingUnits!.find(unit => unit.unitsPerPackage === Number(lines[index].packSize))!.name} packs
          </label>}
          {Number(lines[index].unitCost) === 0 && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={lines[index].zeroCostConfirmed} onChange={e => setLines(previous => previous.map((line, i) => i === index ? { ...line, zeroCostConfirmed: e.target.checked } : line))} />These goods are confirmed free</label>}
        </div>)}
        <div className="grid gap-3 sm:grid-cols-3">{(['freight','acquisitionTax','invoiceDiscount'] as const).map((field, index) => <Input key={field} label={['Freight','Nonrecoverable acquisition tax','Invoice discount'][index]} type="number" min={0} step="0.01" value={charges[field]} onChange={e => setCharges(old => ({ ...old, [field]: e.target.value }))} />)}</div>
        <p className="text-xs text-muted-foreground">Invoice charges apply to accepted merchandise and are allocated by its value. Invoice and payment dates do not change the stock receipt date.</p>
        <label className="flex items-center gap-3 min-h-[44px] text-sm"><input type="checkbox" checked={finalDelivery} onChange={e => setFinalDelivery(e.target.checked)} />Close the order after this delivery, including any missing units</label>
        {finalDelivery && missing > 0 && <p className="text-sm text-warning">{missing} missing units will remain documented. They will not be added to stock.</p>}
        <label className="block text-sm font-medium">Delivery notes / discrepancy reason<textarea className="mt-1 block min-h-[80px] w-full rounded-md border border-input bg-background p-3 text-sm" value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} /></label>
      </fieldset>
      <p className="text-sm text-muted-foreground">{pending ? 'Retry checks whether this delivery was already recorded.' : !missing || finalDelivery ? 'This delivery will close the order.' : `${missing} units will remain open for a later delivery.`}</p>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button disabled={saving} onClick={save}>{saving ? 'Recording…' : pending ? 'Retry saved delivery' : 'Record delivery'}</Button></div>
    </div>
  </Modal>;
}
