import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ProductPicker } from '@/components/common/ProductPicker';
import { inventoryTransferService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/lib/utils';
import { Transfer, TransferReceiptKind, TransferReceiptLine, TransferReceiptRequest, outstandingTransfer, returningTransfer, transferProductName, transferRetryKey, pendingTransferReceipt } from '@/types/transfers';

interface Mapping { transferItemId: string; automaticProductId: string | null; candidates: Array<{ id: string; name: string; sku: string; usable: boolean }> }
interface Props { transfer: Transfer; kind: TransferReceiptKind; onClose: () => void; onSaved: () => void }
export function TransferReceiptModal({ transfer, kind, onClose, onSaved }: Props) {
  const userId = useAuthStore(s => s.user?.id);
  const storageKey = transferRetryKey(transfer, userId, kind);
  const [pending, setPending] = useState(() => pendingTransferReceipt(storageKey));
  const [lines, setLines] = useState<TransferReceiptLine[]>(() => pending?.items || (kind === 'REQUEST_RETURN' ? [] : transfer.items.map(item => ({
    transferItemId: item.id, acceptedQty: kind === 'SOURCE_RETURN' ? returningTransfer(item) : outstandingTransfer(item),
    damagedQty: 0, missingQty: 0, sentBackQty: 0,
    ...(kind === 'RECEIVE' && item.destinationProductId ? { destinationProductId: item.destinationProductId } : {}),
  }))));
  const [notes, setNotes] = useState(pending?.notes || '');
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mappingLoading, setMappingLoading] = useState(kind === 'RECEIVE' && !pending);
  const [mappingError, setMappingError] = useState(false);
  const [mappingRetry, setMappingRetry] = useState(0);
  const [searchingItem, setSearchingItem] = useState<string | null>(null);
  const [chosenNames, setChosenNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (kind !== 'RECEIVE' || pending) return;
    let cancelled = false; setMappingLoading(true); setMappingError(false);
    inventoryTransferService.mappingOptions(transfer.id).then(({ data }) => {
      if (cancelled) return;
      const options: Mapping[] = data.data; setMappings(options);
      setLines(current => current.map(line => {
        const mapping = options.find(option => option.transferItemId === line.transferItemId);
        return !line.destinationProductId && !line.createProduct && mapping?.automaticProductId ? { ...line, destinationProductId: mapping.automaticProductId } : line;
      }));
    }).catch(() => { if (!cancelled) setMappingError(true); }).finally(() => { if (!cancelled) setMappingLoading(false); });
    return () => { cancelled = true; };
  }, [transfer.id, kind, mappingRetry, !!pending]);
  const change = (id: string, patch: Partial<TransferReceiptLine>) => {
    setError('');
    setLines(current => current.map(line => line.transferItemId === id ? { ...line, ...patch } : line));
    if ('destinationProductId' in patch) setChosenNames(current => ({ ...current, [id]: '' }));
  };
  const save = async () => {
    if (submitting.current) return;
    setError(''); let payload: TransferReceiptRequest | null = pending;
    if (!payload) {
      const invalid = lines.some(line => {
        const item = transfer.items.find(item => item.id === line.transferItemId)!;
        const values = [line.acceptedQty, line.damagedQty, line.missingQty, line.sentBackQty];
        return values.some(value => !Number.isSafeInteger(value) || value < 0) || values.reduce((a, b) => a + b, 0) > (kind === 'SOURCE_RETURN' ? returningTransfer(item) : outstandingTransfer(item));
      });
      if (invalid) { setError('Use whole, non-negative quantities within the remaining units for each item.'); return; }
      const nonzero = lines.filter(line => line.acceptedQty + line.damagedQty + line.missingQty + line.sentBackQty > 0);
      if (kind !== 'REQUEST_RETURN' && !nonzero.length) { setError('Enter at least one received or resolved unit.'); return; }
      if ((kind === 'REQUEST_RETURN' || nonzero.some(line => line.damagedQty || line.missingQty || line.sentBackQty)) && !notes.trim()) { setError('Add a reason for the return or discrepancy.'); return; }
      if (kind === 'RECEIVE' && nonzero.some(line => line.acceptedQty > 0 && !line.destinationProductId && !line.createProduct)) { setError('Choose a destination product for every accepted item.'); return; }
      if (nonzero.some(line => line.createProduct && !line.newSku?.trim())) { setError('Enter a SKU for each new destination product.'); return; }
      payload = { idempotencyKey: crypto.randomUUID(), notes: notes.trim(), items: nonzero };
      try { localStorage.setItem(storageKey, JSON.stringify(payload)); } catch { setError('Allow browser storage so this transfer can be retried safely.'); return; }
      setPending(payload);
    }
    submitting.current = true; setSaving(true);
    try {
      await inventoryTransferService.recordReceipt(transfer.id, kind, payload);
      try { localStorage.removeItem(storageKey); } catch { /* A retained key only replays this event. */ }
      onSaved();
    } catch (failure: unknown) {
      const response = (failure as { response?: { status: number; data?: { error?: string } } }).response;
      if (response && [400, 404, 409].includes(response.status)) {
        try { localStorage.removeItem(storageKey); } catch { /* The server did not commit this event. */ }
        setPending(null);
      }
      setError(response?.data?.error || 'The result is uncertain. Retry this saved event to check it safely.');
    } finally { submitting.current = false; setSaving(false); }
  };
  const title = kind === 'RECEIVE' ? 'Receive transfer' : kind === 'SOURCE_RETURN' ? 'Record returned goods' : 'Request a return';
  return <Modal isOpen onClose={() => { if (!saving) onClose(); }} title={title} size="xl">
    <div className="space-y-4">
      <p className="text-sm font-medium break-all">{transfer.transferNumber}</p>
      <p className="text-sm text-muted-foreground">{kind === 'REQUEST_RETURN' ? 'This request asks the destination to send unreceived goods back. Source stock changes only when returned goods physically arrive and are recorded.' : kind === 'SOURCE_RETURN' ? 'Record goods physically returned to the source. Only accepted units become available stock.' : 'Accepted units enter destination stock. Record Send back only when those units are dispatched back to the source. Goods still expected should remain unresolved.'}</p>
      {kind !== 'REQUEST_RETURN' && <p className="text-sm text-muted-foreground">Damaged units stay out of available stock. Use Missing only for confirmed loss; leave units still travelling unresolved.</p>}
      {pending && <p role="status" className="rounded border p-3 text-sm">A saved event is awaiting confirmation. Retry it before recording another delivery.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {mappingLoading && <p role="status">Loading destination product matches…</p>}
      {mappingError && <p role="alert">Could not load product matches. <Button variant="outline" onClick={() => setMappingRetry(n => n + 1)}>Retry matches</Button></p>}
      <fieldset disabled={saving || !!pending || mappingLoading} className="space-y-4">
        {lines.map(line => {
          const item = transfer.items.find(item => item.id === line.transferItemId)!;
          const remaining = kind === 'SOURCE_RETURN' ? returningTransfer(item) : outstandingTransfer(item);
          if (!remaining && !pending) return null;
          const name = transferProductName(item);
          const mapping = mappings.find(m => m.transferItemId === item.id);
          const selectedName = chosenNames[item.id] || mapping?.candidates.find(p => p.id === line.destinationProductId)?.name || item.destinationProduct?.name;
          return <div key={item.id} className="rounded-lg border p-3 space-y-3">
            <div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{name}</p><p className="text-sm tabular-nums">{remaining} unresolved</p></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{(['acceptedQty', 'damagedQty', 'missingQty', ...(kind === 'RECEIVE' ? ['sentBackQty'] : [])] as Array<'acceptedQty' | 'damagedQty' | 'missingQty' | 'sentBackQty'>).map((field, index) => <Input key={field} label={['Accepted', 'Damaged', 'Missing', 'Send back'][index]} aria-label={`${name} ${['accepted', 'damaged', 'missing', 'send back'][index]}`} type="number" inputMode="numeric" min={0} max={remaining} step={1} value={line[field]} onChange={e => change(item.id, { [field]: Number(e.target.value) })} />)}</div>
            {kind === 'RECEIVE' && line.acceptedQty > 0 && <div className="border-t pt-3 space-y-2">
              <p className="text-sm">Destination product: <strong>{line.createProduct ? 'Create from shipment' : selectedName || (line.destinationProductId ? 'Saved product selection' : 'Choose a match')}</strong></p>
              {!item.destinationProductId && <>
                {!line.destinationProductId && !line.createProduct && <p className="text-sm text-muted-foreground">Confirm the product identity. Matching a SKU alone may identify a different item.</p>}
                <div className="flex flex-wrap gap-2">{mapping?.candidates.map(candidate => <Button key={candidate.id} size="sm" className="h-auto min-h-11 py-2 break-words" variant="outline" disabled={!candidate.usable} onClick={() => change(item.id, { destinationProductId: candidate.id, createProduct: false, newSku: undefined })}>Use {candidate.name} ({candidate.sku})</Button>)}
                  <Button size="sm" className="h-auto min-h-11 py-2" variant="outline" onClick={() => setSearchingItem(searchingItem === item.id ? null : item.id)}>Search destination products</Button>
                  <Button size="sm" className="h-auto min-h-11 py-2" variant="outline" onClick={() => change(item.id, { createProduct: true, destinationProductId: undefined, newSku: item.productSnapshot?.sku || item.product?.sku })}>Create product here</Button>
                </div>
                {line.createProduct && <><Input label="New destination SKU" value={line.newSku || ''} onChange={e => change(item.id, { newSku: e.target.value })} />{item.productSnapshot && <p className="text-xs text-muted-foreground">Shipment price {formatCurrency(item.productSnapshot.price)}, cost {formatCurrency(item.productSnapshot.cost)}. The new product keeps these values.</p>}</>}
                {searchingItem === item.id && <ProductPicker locationId={transfer.toLocationId} selectedIds={line.destinationProductId ? [line.destinationProductId] : []} onSelect={product => { change(item.id, { destinationProductId: product.id, createProduct: false, newSku: undefined }); setChosenNames(current => ({ ...current, [item.id]: product.name })); setSearchingItem(null); }} />}
              </>}
            </div>}
          </div>;
        })}
        <label className="block text-sm font-medium">Reason / notes<textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} className="mt-1 block w-full min-h-[80px] rounded border border-input bg-background p-3" /></label>
      </fieldset>
      <div className="flex justify-end gap-2"><Button className="min-h-11" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button className="min-h-11" disabled={saving || (!pending && mappingLoading)} onClick={save}>{saving ? 'Saving…' : pending ? 'Retry saved event' : kind === 'REQUEST_RETURN' ? 'Send return request' : 'Record quantities'}</Button></div>
    </div>
  </Modal>;
}
