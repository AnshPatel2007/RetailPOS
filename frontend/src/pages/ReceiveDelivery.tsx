import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, PackageCheck, Plus, Search, Trash2 } from 'lucide-react';
import { FormSection, ManagementPage } from '@/components/common/Workspace';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { SupplierPicker } from '@/components/common/SupplierPicker';
import { CameraScanner } from '@/components/common/CameraScanner';
import { PickableProduct, ProductPicker } from '@/components/common/ProductPicker';
import { ImportReview } from '@/components/inventory/ImportReview';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useConfirm } from '@/components/ui/useConfirm';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useInventoryImport } from '@/hooks/useInventoryImport';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useAuthStore } from '@/store/authStore';
import { BarcodeMatch, productService, purchaseOrderService } from '@/services/api';
import { hardware } from '@/services/hardware';
import { sessionGeneration } from '@/services/sessionGeneration';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { outstandingQuantity, PurchaseOrder } from '@/types/purchasing';
import {
  addScan, amount, DeliveryDraft, DeliveryLine, emptyDraft, fillAsOrdered, lineFromMatch, lineIssues, lineTotal, lineUnits, newItemLine,
  parseDraft, pendingShelfCount, pickMatch, receiptItems, ScanMatch, serializeDraft, shelfCountOffered, unitCostOf, whole, withOrderLines, withoutOrder,
} from '@/lib/deliveryLines';

const newKey = () => crypto.randomUUID();
const errorText = (failure: unknown, fallback: string) => (failure as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;
const statusOf = (failure: unknown) => (failure as { response?: { status?: number } }).response?.status;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const EXCEPTIONS = '/inventory/stock-control/exceptions';

interface NewItemForm { code: string; name: string; sku: string; price: string; cost: string; units: string }

const describeMatch = (match: BarcodeMatch) => match.kind === 'SUPPLIER_CASE' ? `${match.supplierCase.supplierName} case of ${match.supplierCase.packSize}`
  : match.kind === 'PACK' ? `Pack of ${match.product.unitsPerPackage || 1}` : `Single · ${match.product.sku}`;

/**
 * Receive a delivery on a phone: choose the supplier (and optionally its open
 * order), scan what arrived, then review and save through the reviewed receipt
 * import, the same write path as the invoice photo. Low items offer a quick
 * shelf count first, posted before the receipt. The list is kept in this
 * browser until it is saved.
 */
export default function ReceiveDelivery() {
  const { locationId, isReadOnly } = useEffectiveLocation();
  const userId = useAuthStore(state => state.user?.id);
  const storageKey = `pos-receive-delivery:${locationId || ''}:${userId || ''}`;
  const [draft, setDraftState] = useState<DeliveryDraft>(emptyDraft);
  const draftRef = useRef(draft);
  const [loadedKey, setLoadedKey] = useState('');
  // Scans arrive faster than renders: every change starts from the latest list.
  const setDraft = useCallback((change: (current: DeliveryDraft) => DeliveryDraft) => {
    draftRef.current = change(draftRef.current);
    setDraftState(draftRef.current);
  }, []);

  useEffect(() => {
    let saved: DeliveryDraft | null = null;
    try { saved = parseDraft(localStorage.getItem(storageKey)); } catch { /* storage unavailable: start empty */ }
    draftRef.current = saved || emptyDraft();
    setDraftState(draftRef.current);
    setLoadedKey(storageKey);
  }, [storageKey]);
  useEffect(() => {
    if (loadedKey !== storageKey) return;
    try {
      if (draft.supplier || draft.lines.length) localStorage.setItem(storageKey, serializeDraft(draft));
      else localStorage.removeItem(storageKey);
    } catch { /* keeping the list is a convenience */ }
  }, [draft, loadedKey, storageKey]);

  const onSaved = useCallback(() => {
    setDraft(() => emptyDraft());
    try { localStorage.removeItem(storageKey); } catch { /* nothing to clear */ }
  }, [setDraft, storageKey]);
  const workflow = useInventoryImport('RECEIPT', onSaved, true);

  const [lookups, setLookups] = useState(0);
  const [scanError, setScanError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [highlight, setHighlight] = useState<{ key: string; at: number } | null>(null);
  const [choices, setChoices] = useState<{ code: string; matches: BarcodeMatch[] } | null>(null);
  const [newItem, setNewItem] = useState<NewItemForm | null>(null);
  const [findByName, setFindByName] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [countingShelves, setCountingShelves] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [confirm, confirmDialog] = useConfirm();

  const reviewing = !!workflow.preview || !!workflow.pending || !!workflow.result;
  const locked = isReadOnly || reviewing || workflow.busy || countingShelves;

  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(null), 1600);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  const updateLine = useCallback((key: string, patch: Partial<DeliveryLine>) =>
    setDraft(current => ({ ...current, lines: current.lines.map(line => line.key === key ? { ...line, ...patch } : line) })), [setDraft]);

  const addLine = useCallback((line: DeliveryLine) => {
    let note = '', key = '';
    setDraft(current => { const result = addScan(current.lines, line); note = result.note; key = result.key; return { ...current, lines: result.lines }; });
    setAnnouncement(note); setHighlight({ key, at: Date.now() });
    setScanError(''); setChoices(null); setNewItem(null);
    hardware.sound.play('ok');
  }, [setDraft]);

  const handleCode = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code || locked) return;
    const supplier = draftRef.current.supplier;
    if (!supplier) { setScanError('Choose the supplier first, then scan.'); hardware.sound.play('error'); return; }
    const added = draftRef.current.lines.find(line => line.kind === 'NEW' && line.barcode === code);
    if (added) {
      const units = whole(added.units) + 1;
      updateLine(added.key, { units: String(units) });
      setAnnouncement(`${added.name}: ${plural(units, 'unit')}`); setHighlight({ key: added.key, at: Date.now() });
      hardware.sound.play('ok');
      return;
    }
    const generation = sessionGeneration();
    setLookups(count => count + 1); setScanError('');
    try {
      const matches = (await productService.resolveBarcode(code)).data.data.matches;
      if (generation !== sessionGeneration()) return;
      const picked = pickMatch(matches, supplier.id);
      if (!picked) {
        hardware.sound.play('error');
        setChoices(null); setFindByName(false);
        setNewItem({ code, name: '', sku: code, price: '', cost: '', units: '1' });
        setAnnouncement(`${code} is not one of your products yet.`);
      } else if ('choices' in picked) {
        setChoices({ code, matches: picked.choices }); setNewItem(null);
        setAnnouncement(`${code} matches more than one item. Choose the one that arrived.`);
      } else addLine(lineFromMatch(picked.match, newKey));
    } catch (failure) {
      if (generation !== sessionGeneration()) return;
      hardware.sound.play('error');
      setScanError(errorText(failure, 'The barcode lookup did not answer. Check the connection and scan again.'));
    } finally { setLookups(count => count - 1); }
  }, [addLine, locked, updateLine]);

  // A USB scanner works anywhere on the page while no field has focus.
  const scan = useRef(handleCode);
  scan.current = handleCode;
  useEffect(() => {
    const listener = (code: string) => { void scan.current(code); };
    hardware.scanner.onScan(listener);
    return () => hardware.scanner.offScan(listener);
  }, []);

  const addPicked = async (product: PickableProduct) => {
    setFindByName(false); setNewItem(null);
    const generation = sessionGeneration();
    const barcode = (product as PickableProduct & { barcode?: string | null }).barcode;
    if (barcode) {
      try {
        const match = (await productService.resolveBarcode(barcode)).data.data.matches.find(candidate => candidate.kind === 'PRODUCT' && candidate.product.id === product.id);
        if (generation !== sessionGeneration()) return;
        if (match) { addLine(lineFromMatch(match, newKey)); return; }
      } catch { /* fall back to the search result */ }
    }
    // Without a fresh lookup an open stock exception is unknown, so no shelf count is offered.
    addLine({ ...lineFromMatch({ kind: 'PRODUCT', product: product as unknown as ScanMatch['product'] }, newKey), recorded: null });
  };

  const addNewItem = () => {
    if (!newItem?.name.trim()) return;
    const line = newItemLine(newItem, newKey);
    setDraft(current => ({ ...current, lines: [line, ...current.lines] }));
    setAnnouncement(`Added ${line.name} as a new item`); setHighlight({ key: line.key, at: Date.now() });
    setNewItem(null); hardware.sound.play('ok');
  };

  const openOrders = useScopedQuery<PurchaseOrder[]>(['receive-open-orders', draft.supplier?.id], async signal =>
    ((await purchaseOrderService.getAll({ supplierId: draft.supplier?.id, limit: 50 }, signal)).data.data as PurchaseOrder[])
      .filter(order => ['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status)),
  !!draft.supplier && !isReadOnly, 0, { autoRefresh: false });

  const chooseSupplier = (supplier: { id: string; name: string }) => {
    if (draftRef.current.supplier?.id === supplier.id) return;
    setDraft(current => ({ ...current, supplier: { id: supplier.id, name: supplier.name }, order: null, lines: current.order ? withoutOrder(current.lines) : current.lines }));
    setScanError('');
  };

  const chooseOrder = async (id: string) => {
    setReviewError('');
    if (!id) { setDraft(current => ({ ...current, order: null, lines: withoutOrder(current.lines) })); return; }
    const generation = sessionGeneration();
    setOrderLoading(true);
    try {
      const order = (await purchaseOrderService.getById(id)).data.data as PurchaseOrder;
      if (generation !== sessionGeneration()) return;
      const items = (order.items || []).map(item => ({ ...item, outstanding: outstandingQuantity(item) }));
      setDraft(current => ({ ...current, order: { id: order.id, orderNumber: order.orderNumber }, lines: withOrderLines(withoutOrder(current.lines), items, newKey) }));
    } catch (failure) {
      if (generation === sessionGeneration()) setReviewError(errorText(failure, 'The order did not load. Choose it again.'));
    } finally { if (generation === sessionGeneration()) setOrderLoading(false); }
  };

  const changeShelfCount = (line: DeliveryLine, shelfCount: string) =>
    updateLine(line.key, { shelfCount, countSaved: false, countError: '', countKey: line.countSaved ? newKey() : line.countKey });

  const startOver = async () => {
    if (!await confirm({ title: 'Start over?', message: 'The items on this delivery are cleared. Shelf counts already saved stay saved.', confirmLabel: 'Start over', destructive: true })) return;
    setDraft(() => emptyDraft());
    setChoices(null); setNewItem(null); setFindByName(false); setScanError(''); setReviewError(''); setAnnouncement('');
  };

  const order = draft.order;
  const issues = useMemo(() => new Map(draft.lines.map(line => [line.key, lineIssues(line, order)])), [draft.lines, order]);
  const receiving = draft.lines.filter(line => lineUnits(line) > 0);
  const totalUnits = receiving.reduce((sum, line) => sum + lineUnits(line), 0);
  const totalCost = Math.round(receiving.reduce((sum, line) => sum + lineTotal(line), 0) * 100) / 100;
  const leftOut = draft.lines.length - receiving.length;
  const problemLines = draft.lines.filter(line => (issues.get(line.key) || []).length).length;
  const chargeError = (text: string) => text.trim() && amount(text) === null ? 'Enter an amount, or leave it blank.' : undefined;
  const chargesInvalid = (['freight', 'tax', 'discount'] as const).some(field => chargeError(draft.invoice[field]));
  const canFill = !!order && draft.lines.some(line => line.ordered !== null && line.ordered > 0 && lineUnits(line) === 0);

  const review = async () => {
    setReviewError('');
    const current = draftRef.current;
    if (!current.supplier) { setReviewError('Choose the supplier.'); return; }
    if (!receiving.length) { setReviewError('Scan or enter at least one item that arrived.'); return; }
    if (problemLines || chargesInvalid) { setReviewError(problemLines ? `Fix the ${plural(problemLines, 'item')} marked below first.` : 'Fix the invoice details first.'); return; }
    // Shelf counts go in before the delivery, so each one is of the shelf without it.
    const generation = sessionGeneration();
    setCountingShelves(true);
    try {
      for (const line of current.lines) {
        const count = pendingShelfCount(line);
        if (!count) continue;
        if (count.change === 0) { updateLine(line.key, { countSaved: true, countError: '' }); continue; }
        try {
          const saved = (await productService.adjustInventory(count.productId, { quantity: count.change, type: 'MANUAL_COUNT', notes: 'Shelf count before a delivery',
            expectedVersion: count.expectedVersion, idempotencyKey: count.idempotencyKey })).data.data as { stockQuantity: number; stockVersion: number };
          if (generation !== sessionGeneration()) return;
          updateLine(line.key, { countSaved: true, countError: '', recorded: { ...count.recorded, quantity: saved.stockQuantity, version: saved.stockVersion } });
        } catch (failure) {
          if (generation !== sessionGeneration()) return;
          let message = errorText(failure, 'The shelf count was not saved. Review again to retry it.');
          if (statusOf(failure) === 409) {
            message = 'Stock changed while you were counting (a sale or another change). Count the shelf again, then review.';
            try {
              const product = (await productService.getById(count.productId)).data.data as { stockQuantity: number; stockVersion: number };
              updateLine(line.key, { recorded: { ...count.recorded, quantity: product.stockQuantity, version: product.stockVersion } });
              message = `Stock changed while you were counting; the record now shows ${product.stockQuantity}. Count the shelf again, then review.`;
            } catch { /* keep the earlier record */ }
          }
          updateLine(line.key, { countError: message });
          setReviewError(`The shelf count for ${line.name} was not saved. Nothing else was changed.`);
          return;
        }
      }
    } finally { if (generation === sessionGeneration()) setCountingShelves(false); }
    const { supplier, invoice, lines } = draftRef.current;
    await workflow.review({
      supplier: supplier?.name, purchaseOrderId: draftRef.current.order?.id, invoiceNumber: invoice.number.trim() || undefined,
      invoiceDate: invoice.date ? invoice.date + 'T12:00:00.000Z' : undefined,
      freight: amount(invoice.freight) ?? 0, acquisitionTax: amount(invoice.tax) ?? 0, invoiceDiscount: amount(invoice.discount) ?? 0,
      items: receiptItems(lines),
    });
  };

  const setInvoice = (field: keyof DeliveryDraft['invoice'], value: string) => setDraft(current => ({ ...current, invoice: { ...current.invoice, [field]: value } }));
  const orderList = openOrders.data || [];

  return (
    <ManagementPage>
      <PageHeader title="Receive Delivery" icon={PackageCheck}
        actions={draft.lines.length > 0 && !reviewing && !isReadOnly ? <Button variant="ghost" onClick={() => void startOver()} disabled={locked}>Start over</Button> : undefined} />
      {confirmDialog}
      <div className="mx-auto w-full max-w-3xl space-y-4 pb-2">
        {isReadOnly && <Alert tone="info">This store is open for viewing only, so deliveries cannot be received here.</Alert>}
        {workflow.error && <Alert tone="error">{workflow.error}</Alert>}

        {isReadOnly ? null : workflow.pending ? (
          <Alert tone="warning" title="A delivery from this browser was not confirmed"
            action={<Button size="sm" disabled={workflow.busy} onClick={() => void workflow.commit()}>Finish saving</Button>}>
            It was sent, but the answer did not come back. Finishing saves it once; it is never added twice.
          </Alert>
        ) : workflow.result ? (
          <Alert tone="success" title="Delivery saved" action={<Button size="sm" onClick={workflow.clearResult}>Receive another</Button>}>
            {plural(workflow.result.total, 'item')} received ({workflow.result.updated} existing, {workflow.result.created} new). Stock and costs are updated.
          </Alert>
        ) : workflow.preview ? (
          <section aria-labelledby="delivery-review" className="space-y-4 rounded-lg border bg-card p-4">
            <h2 id="delivery-review" className="text-lg font-semibold">Check the delivery</h2>
            <ImportReview preview={workflow.preview} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={workflow.busy} onClick={workflow.resetPreview}>Back to edit</Button>
              {workflow.preview.id && <Button disabled={workflow.busy} onClick={() => void workflow.commit()}>{workflow.busy ? 'Saving…' : 'Save delivery'}</Button>}
            </div>
          </section>
        ) : <>
          <section aria-label="Supplier and order" className="space-y-3 rounded-lg border bg-card p-4">
            <SupplierPicker locationId={locationId || undefined} selected={draft.supplier} onSelect={chooseSupplier} />
            {draft.supplier && <Select label="Order (optional)" value={order?.id || ''} disabled={orderLoading || locked}
              onChange={event => void chooseOrder(event.target.value)}
              description={openOrders.loading ? 'Looking for open orders…' : openOrders.error ? 'Open orders did not load.' : orderList.length ? 'Pick the order this delivery fills to see what is expected.' : `No open orders from ${draft.supplier.name}.`}>
              <option value="">No order: a new delivery</option>
              {order && !orderList.some(candidate => candidate.id === order.id) && <option value={order.id}>{order.orderNumber}</option>}
              {orderList.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.orderNumber} · ordered {formatDate(candidate.orderedAt || candidate.createdAt)}</option>)}
            </Select>}
          </section>

          <section aria-label="Scan items" className="space-y-3 rounded-lg border bg-card p-4">
            <CameraScanner onCode={code => void handleCode(code)} disabled={locked || !draft.supplier} />
            {!draft.supplier && <p className="text-sm text-muted-foreground">Choose the supplier first, then scan each case, pack or item as it comes off the truck.</p>}
            {lookups > 0 && <p role="status" className="text-sm text-muted-foreground">Looking up…</p>}
            {scanError && <p role="alert" className="text-sm text-destructive">{scanError}</p>}
            <p className="text-sm text-muted-foreground" aria-live="polite">{announcement}</p>
            {draft.supplier && !findByName && <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => { setFindByName(true); setNewItem(null); setChoices(null); }}>
              <Search className="h-4 w-4" aria-hidden="true" />No barcode? Find the item by name</Button>}
            {findByName && locationId && <div className="space-y-2">
              <ProductPicker locationId={locationId} selectedIds={[]} onSelect={product => void addPicked(product)} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setFindByName(false)}>Close search</Button>
            </div>}

            {choices && <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">{choices.code} matches more than one item. Which one arrived?</p>
              {choices.matches.map((match, index) => <button key={index} type="button" onClick={() => addLine(lineFromMatch(match, newKey))}
                className="block min-h-11 w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-accent">
                <span className="font-medium">{match.product.name}</span>
                <span className="block text-xs text-muted-foreground">{describeMatch(match)}</span>
              </button>)}
              <Button type="button" variant="ghost" size="sm" onClick={() => setChoices(null)}>Cancel</Button>
            </div>}

            {newItem && <form aria-label="New item" onSubmit={event => { event.preventDefault(); addNewItem(); }} className="space-y-3 rounded-lg border border-info/30 bg-info/5 p-3">
              <p className="text-sm"><span className="font-medium">{newItem.code}</span> is not one of your products. Add it as a new item, or{' '}
                <button type="button" className="text-primary underline" onClick={() => { setNewItem(null); setFindByName(true); }}>find the item by name</button> if it is listed without this barcode.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Name" autoFocus value={newItem.name} onChange={event => setNewItem({ ...newItem, name: event.target.value })} />
                <Input label="SKU" value={newItem.sku} description="Starts as the barcode." onChange={event => setNewItem({ ...newItem, sku: event.target.value })} />
                <Input label="Selling price" type="number" inputMode="decimal" min="0.01" step="0.01" value={newItem.price} onChange={event => setNewItem({ ...newItem, price: event.target.value })} />
                <Input label="Cost each" type="number" inputMode="decimal" min="0" step="0.01" value={newItem.cost} onChange={event => setNewItem({ ...newItem, cost: event.target.value })} />
                <Input label="Units that arrived" inputMode="numeric" value={newItem.units} onChange={event => setNewItem({ ...newItem, units: event.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setNewItem(null)}>Cancel</Button>
                <Button type="submit" disabled={!newItem.name.trim()}>Add item</Button>
              </div>
            </form>}
          </section>

          <section aria-labelledby="delivery-items" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="delivery-items" className="text-base font-semibold">Items ({draft.lines.length})</h2>
              {canFill && <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => setDraft(current => ({ ...current, lines: fillAsOrdered(current.lines) }))}>Fill the rest as ordered</Button>}
            </div>
            {draft.lines.length === 0
              ? <div className="rounded-lg border bg-card py-8"><EmptyState icon={PackageCheck} title="Nothing scanned yet" hint="Each scan adds one case, pack or item. Scan it again for one more, or type the quantity." /></div>
              : <ul className="space-y-3">{draft.lines.map(line => <LineCard key={line.key} line={line} issues={issues.get(line.key) || []} disabled={locked}
                  highlighted={highlight?.key === line.key} onChange={patch => updateLine(line.key, patch)} onShelfCount={value => changeShelfCount(line, value)}
                  onRemove={() => setDraft(current => ({ ...current, lines: current.lines.filter(candidate => candidate.key !== line.key) }))} />)}</ul>}
          </section>

          <FormSection title="Invoice details" summary="Optional" collapsible defaultOpen={!!(draft.invoice.number || draft.invoice.freight || draft.invoice.tax || draft.invoice.discount)}
            description="Freight and tax are spread across the items' costs; an invoice discount lowers them.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Invoice number" value={draft.invoice.number} disabled={locked} onChange={event => setInvoice('number', event.target.value)} />
              <Input label="Invoice date" type="date" value={draft.invoice.date} disabled={locked} onChange={event => setInvoice('date', event.target.value)} />
              <Input label="Freight" type="number" inputMode="decimal" min="0" step="0.01" value={draft.invoice.freight} disabled={locked} error={chargeError(draft.invoice.freight)} onChange={event => setInvoice('freight', event.target.value)} />
              <Input label="Tax on the invoice" type="number" inputMode="decimal" min="0" step="0.01" value={draft.invoice.tax} disabled={locked} error={chargeError(draft.invoice.tax)} onChange={event => setInvoice('tax', event.target.value)} />
              <Input label="Invoice discount" type="number" inputMode="decimal" min="0" step="0.01" value={draft.invoice.discount} disabled={locked} error={chargeError(draft.invoice.discount)} onChange={event => setInvoice('discount', event.target.value)} />
            </div>
          </FormSection>

          {draft.lines.length > 0 && <div className="sticky bottom-0 z-10 space-y-1 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">{plural(receiving.length, 'item')} · {plural(totalUnits, 'unit')}</p>
                <p className="text-muted-foreground">About {formatCurrency(totalCost)} before invoice charges</p>
              </div>
              <Button onClick={() => void review()} disabled={locked || !receiving.length}>
                {countingShelves ? 'Saving shelf counts…' : workflow.busy ? 'Checking…' : 'Review delivery'}
              </Button>
            </div>
            {leftOut > 0 && <p className="text-xs text-muted-foreground">{plural(leftOut, 'item')} with no quantity will be left out.</p>}
            {reviewError && <p role="alert" className="text-sm text-destructive">{reviewError}</p>}
          </div>}
          {draft.lines.length === 0 && reviewError && <p role="alert" className="text-sm text-destructive">{reviewError}</p>}
        </>}
      </div>
    </ManagementPage>
  );
}

function Stepper({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const id = useId();
  const count = whole(value);
  return <div className="min-w-0">
    <label htmlFor={id} className="mb-1.5 block truncate text-sm font-medium">{label}</label>
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size="icon" aria-label={`One fewer: ${label}`} disabled={disabled || count === 0} onClick={() => onChange(count > 1 ? String(count - 1) : '')}>
        <Minus className="h-4 w-4" aria-hidden="true" /></Button>
      <input id={id} inputMode="numeric" autoComplete="off" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}
        className="app-input h-9 w-full min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-center text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" />
      <Button type="button" variant="outline" size="icon" aria-label={`One more: ${label}`} disabled={disabled} onClick={() => onChange(String(count + 1))}>
        <Plus className="h-4 w-4" aria-hidden="true" /></Button>
    </div>
  </div>;
}

function LineCard({ line, issues, highlighted, disabled, onChange, onShelfCount, onRemove }: {
  line: DeliveryLine; issues: string[]; highlighted: boolean; disabled: boolean;
  onChange: (patch: Partial<DeliveryLine>) => void; onShelfCount: (value: string) => void; onRemove: () => void;
}) {
  const card = useRef<HTMLLIElement>(null);
  useEffect(() => { if (highlighted) card.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [highlighted]);
  const units = lineUnits(line);
  const unitCost = unitCostOf(line);
  const previous = line.previousUnitCost;
  const costMoved = previous !== null && unitCost !== null && unitCost > 0 && Math.abs(unitCost - previous) >= 0.005;
  const size = line.packSize > 1 ? `${line.packLabel || 'Case'} of ${line.packSize}` : null;
  const name = line.name || 'New item';
  return <li ref={card} aria-label={name} className={cn('space-y-3 rounded-lg border bg-card p-3 transition-shadow sm:p-4', highlighted && 'ring-2 ring-primary', issues.length > 0 && 'border-destructive/60')}>
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-5">{name}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {line.kind === 'NEW' ? <Badge>New item</Badge> : <span>{line.sku}</span>}
          {size && <span>{size}</span>}
          {line.ordered !== null && <span>Ordered {line.ordered}</span>}
        </p>
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${name}`} disabled={disabled} onClick={onRemove}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
    </div>
    {line.kind === 'NEW' && <div className="grid gap-3 sm:grid-cols-3">
      <Input label="Name" value={line.name} disabled={disabled} onChange={event => onChange({ name: event.target.value })} />
      <Input label="SKU" value={line.sku} disabled={disabled} onChange={event => onChange({ sku: event.target.value })} />
      <Input label="Selling price" type="number" inputMode="decimal" min="0.01" step="0.01" value={line.price} disabled={disabled} onChange={event => onChange({ price: event.target.value })} />
    </div>}
    <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3">
      {line.packSize > 1 && <Stepper label={`${line.packLabel || 'Cases'} (of ${line.packSize})`} value={line.cases} disabled={disabled} onChange={cases => onChange({ cases })} />}
      <Stepper label={line.packSize > 1 ? 'Singles' : 'Units'} value={line.units} disabled={disabled} onChange={value => onChange({ units: value })} />
      <div className="min-w-0">
        <Input label={line.packSize > 1 ? `Cost per ${(line.packLabel || 'case').toLowerCase()}` : 'Cost each'} type="number" inputMode="decimal" min="0" step="0.01"
          value={line.cost} disabled={disabled} onChange={event => onChange({ cost: event.target.value })}
          description={line.packSize > 1 && unitCost !== null ? `${formatCurrency(unitCost)} each` : undefined} />
      </div>
    </div>
    {costMoved && previous !== null && unitCost !== null && <p className={cn('text-xs', unitCost > previous ? 'text-warning' : 'text-muted-foreground')}>
      Was {formatCurrency(previous)} each{unitCost > previous ? '; the cost went up.' : '.'}</p>}
    {unitCost === 0 && units > 0 && <Checkbox label="These came free" checked={line.freeConfirmed} disabled={disabled} onChange={event => onChange({ freeConfirmed: event.target.checked })} />}
    {line.openExceptionId
      ? <p className="text-sm text-muted-foreground">This item has an open stock problem. <Link className="text-primary hover:underline" to={EXCEPTIONS}>Resolve it in Stock Control</Link> instead of counting it here.</p>
      : shelfCountOffered(line) && line.recorded && <div className="space-y-2 rounded-md bg-warning/10 p-3">
        <Input label="On the shelf right now, before this delivery (optional)" inputMode="numeric" autoComplete="off" className="max-w-[9rem]" value={line.shelfCount} disabled={disabled}
          onChange={event => onShelfCount(event.target.value)}
          description={`Count every unit, opened or not. The record shows ${line.recorded.quantity}; it runs low at ${line.recorded.lowStockAlert}.`} />
        {line.countSaved && <p role="status" className="text-sm text-success">Shelf count saved. The record now shows {line.recorded.quantity}.</p>}
        {line.countError && <p role="alert" className="text-sm text-destructive">{line.countError}</p>}
      </div>}
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{plural(units, 'unit')}</span>
      <span className="font-medium tabular-nums">{formatCurrency(lineTotal(line))}</span>
    </div>
    {issues.length > 0 && <ul className="space-y-1 text-sm text-destructive">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
  </li>;
}
