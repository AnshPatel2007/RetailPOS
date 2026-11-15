import { useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { DialogActions } from '@/components/ui/DialogActions';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { apiErrorMessage, catalogService } from '@/services/api';
import { chunks, plural, typedPrice } from '@/lib/sharedCatalog';
import { formatCurrency } from '@/lib/utils';
import type { CatalogItem, CatalogStore } from '@/types/sharedCatalog';

const followHint = 'On: the store\'s price changes when you change the shared price. Off: it starts at this price and the store sets its own after.';

/**
 * Add one shared item to a store that does not carry it: the store gets its own item
 * with stock 0 and the shared packs. If the store already has the item under its own
 * record (same SKU or barcode), it is offered for linking instead.
 */
export function AddToStorePanel({ item, onClose, onSaved }: { item: CatalogItem; onClose: () => void; onSaved: (item: CatalogItem) => void }) {
  const formId = useId();
  const [locationId, setLocationId] = useState(item.missingStores[0]?.locationId ?? '');
  const [follow, setFollow] = useState(item.defaultPrice !== null);
  const [price, setPrice] = useState(item.defaultPrice === null ? '' : item.defaultPrice.toFixed(2));
  const [lowStock, setLowStock] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The store already has this item as its own: link it instead of adding a second one.
  const [existing, setExisting] = useState<{ productId: string; message: string } | null>(null);
  const storeName = item.missingStores.find(store => store.locationId === locationId)?.storeName ?? 'The store';

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const own = typedPrice(price);
    if (!locationId) { setError('Choose the store.'); return; }
    if (!follow && own === null) { setError(`Enter ${storeName}'s price.`); return; }
    const alert = lowStock.trim() ? Number(lowStock) : undefined;
    if (alert !== undefined && (!Number.isInteger(alert) || alert < 0)) { setError('Low stock alert is a whole number, or leave it empty.'); return; }
    setSaving(true); setError(''); setExisting(null);
    try {
      const result = (await catalogService.publish(item.id, { locationId, followPrice: follow, ...(follow ? {} : { price: own! }), ...(alert !== undefined ? { lowStockAlert: alert } : {}) })).data.data;
      toast.success(`${item.name} added to ${result.storeName} with stock 0`);
      onSaved(result.item);
      onClose();
    } catch (failure) {
      const details = (failure as { response?: { data?: { details?: { code?: string; existingProductId?: string } } } }).response?.data?.details;
      const message = apiErrorMessage(failure, 'The item was not added. Try again.');
      if (details?.code === 'PRODUCT_EXISTS' && details.existingProductId) setExisting({ productId: details.existingProductId, message });
      else setError(message);
    } finally { setSaving(false); }
  };

  const linkInstead = async () => {
    if (!existing) return;
    setSaving(true); setError('');
    try {
      const fresh = (await catalogService.link(item.id, existing.productId, true)).data.data;
      toast.success(`${storeName}'s item is now linked to ${fresh.name}`);
      onSaved(fresh);
      onClose();
    } catch (failure) { setError(apiErrorMessage(failure, 'Could not link it. Try again.')); }
    finally { setSaving(false); }
  };

  return <Modal isOpen onClose={() => { if (!saving) onClose(); }} size="md" title="Add To Store" description={item.name}
    footer={<DialogActions form={formId} confirmLabel="Add Item" loading={saving} disabled={!item.missingStores.length} onCancel={onClose} />}>
    <form id={formId} onSubmit={save} className="space-y-4" aria-busy={saving}>
      {error && <Alert tone="error">{error}</Alert>}
      {existing && <Alert tone="warning" title={existing.message}
        action={<Button type="button" variant="outline" disabled={saving} onClick={() => void linkInstead()}>Link it instead</Button>}>
        Linking keeps that item&apos;s stock and price; its name, barcode and selling rules become the shared ones.
      </Alert>}
      <fieldset disabled={saving} className="min-w-0 space-y-4">
        <Select label="Store" value={locationId} onChange={event => { setLocationId(event.target.value); setExisting(null); }}>
          {item.missingStores.map(store => <option key={store.locationId} value={store.locationId}>{store.storeName}</option>)}
        </Select>
        <Checkbox label={item.defaultPrice === null ? 'Follow the shared price (this item has none yet)' : `Follow the shared price (${formatCurrency(item.defaultPrice)})`}
          checked={follow} disabled={item.defaultPrice === null} onChange={event => setFollow(event.target.checked)} description={followHint} />
        {!follow && <Input label={`${storeName}'s price`} type="number" inputMode="decimal" min="0.01" step="0.01" value={price} onChange={event => setPrice(event.target.value)} required />}
        <Input label="Low stock alert" type="number" inputMode="numeric" min="0" step="1" value={lowStock} onChange={event => setLowStock(event.target.value)} description="Optional." />
        <p className="text-xs text-muted-foreground">The item starts with stock 0; receive a delivery or count it to add stock.</p>
      </fieldset>
    </form>
  </Modal>;
}

/**
 * Opening a store: add every shared item it does not carry yet, with stock 0. Items that
 * cannot be added (the store has them under its own record, or there is no price) are
 * listed with the reason.
 */
export function AddAllToStorePanel({ stores, onClose, onDone }: { stores: CatalogStore[]; onClose: () => void; onDone: () => void }) {
  const formId = useId();
  const usable = stores.filter(store => store.isActive);
  const [locationId, setLocationId] = useState(usable[0]?.id ?? '');
  const [follow, setFollow] = useState(true);
  const [missing, setMissing] = useState<number | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; skipped: { name: string; reason: string }[] } | null>(null);
  const storeName = stores.find(store => store.id === locationId)?.name ?? 'the store';

  useEffect(() => {
    if (!locationId) return;
    const request = new AbortController();
    setMissing(null);
    catalogService.list({ missingFrom: locationId, limit: 1 }, request.signal)
      .then(response => setMissing(response.data.data.pagination.total))
      .catch(failure => { if (!request.signal.aborted) setError(apiErrorMessage(failure, 'Could not count the items. Try again.')); });
    return () => request.abort();
  }, [locationId]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!locationId || !missing) return;
    setError('');
    try {
      // Every item the store does not carry, then added 500 at a time.
      setWorking('Finding the items...');
      const items: { id: string; name: string }[] = [];
      for (let page = 1, pages = 1; page <= pages; page++) {
        const list = (await catalogService.list({ missingFrom: locationId, limit: 500, page })).data.data;
        pages = list.pagination.totalPages;
        items.push(...list.items.map(entry => ({ id: entry.id, name: entry.name })));
      }
      let created = 0;
      const skipped: { name: string; reason: string }[] = [];
      for (const [index, batch] of chunks(items, 500).entries()) {
        setWorking(`Adding items${items.length > 500 ? ` (${index * 500 + 1}–${Math.min(items.length, (index + 1) * 500)} of ${items.length})` : ''}...`);
        const done = (await catalogService.publishMany({ itemIds: batch.map(entry => entry.id), locationId, followPrice: follow })).data.data;
        created += done.created.length;
        skipped.push(...done.skipped.map(entry => ({ name: batch.find(row => row.id === entry.catalogItemId)?.name ?? 'An item', reason: entry.reason })));
      }
      setResult({ created, skipped });
      onDone();
    } catch (failure) {
      setError(apiErrorMessage(failure, 'Not every item was added. Items already added stay; try again for the rest.'));
      onDone();
    } finally { setWorking(null); }
  };

  // The outcome only shows information, so it has no footer: the header's X closes it.
  if (result) return <Modal isOpen onClose={onClose} size="md" title="Add All To A Store">
    <div className="space-y-4">
      <Alert tone={result.skipped.length ? 'warning' : 'success'} title={`${plural(result.created, 'item')} added to ${storeName} with stock 0`}>
        {result.skipped.length ? `${plural(result.skipped.length, 'item was', 'items were')} not added:` : 'Receive a delivery or count the shelves to add their stock.'}
      </Alert>
      {result.skipped.length > 0 && <ul className="divide-y rounded-md border text-sm">
        {result.skipped.slice(0, 50).map((entry, index) => <li key={index} className="px-3 py-2"><span className="font-medium">{entry.name}</span>: {entry.reason}</li>)}
        {result.skipped.length > 50 && <li className="px-3 py-2 text-muted-foreground">and {result.skipped.length - 50} more</li>}
      </ul>}
    </div>
  </Modal>;

  return <Modal isOpen onClose={() => { if (!working) onClose(); }} size="md" title="Add All To A Store"
    description="For a new store: every shared item it does not carry yet, with stock 0."
    footer={<DialogActions form={formId} confirmLabel={missing ? `Add ${plural(missing, 'item')}` : 'Add Items'} loading={!!working} disabled={!missing} onCancel={onClose} />}>
    <form id={formId} onSubmit={save} className="space-y-4" aria-busy={!!working}>
      {error && <Alert tone="error">{error}</Alert>}
      {working && <p role="status" className="text-sm text-muted-foreground">{working}</p>}
      <fieldset disabled={!!working} className="min-w-0 space-y-4">
        <Select label="Store" value={locationId} onChange={event => setLocationId(event.target.value)}>
          {usable.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
        </Select>
        <p className="text-sm text-muted-foreground" role="status">{missing === null ? 'Counting...' : missing === 0 ? `${storeName} already carries every shared item.`
          : `${plural(missing, 'shared item')} ${missing === 1 ? 'is' : 'are'} not in ${storeName} yet.`}</p>
        <Checkbox label="Follow the shared prices" checked={follow} onChange={event => setFollow(event.target.checked)} description={followHint} />
      </fieldset>
    </form>
  </Modal>;
}
