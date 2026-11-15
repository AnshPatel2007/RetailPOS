import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { DialogActions } from '@/components/ui/DialogActions';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { FormSection } from '@/components/common/Workspace';
import { apiErrorMessage, catalogService } from '@/services/api';
import { plural, priceReach, typedPrice } from '@/lib/sharedCatalog';
import { formatCurrency } from '@/lib/utils';
import type { CatalogItem } from '@/types/sharedCatalog';

/**
 * The shared price of an item and of its shared packs. It reaches the stores that
 * follow the shared price, or every store that carries the item (they then follow it).
 * A store that wants its own price turns off "Follow shared price" on its item.
 */
export function CatalogPricePanel({ item, onClose, onSaved }: { item: CatalogItem; onClose: () => void; onSaved: (item: CatalogItem) => void }) {
  const formId = useId();
  const reach = priceReach(item);
  const packs = item.packs.filter(pack => pack.isActive);
  const [price, setPrice] = useState(item.defaultPrice === null ? '' : item.defaultPrice.toFixed(2));
  const [packPrices, setPackPrices] = useState<Record<string, string>>(() => Object.fromEntries(packs.map(pack => [pack.id, pack.defaultPrice === null ? '' : pack.defaultPrice.toFixed(2)])));
  const [apply, setApply] = useState<'FOLLOWING' | 'ALL'>(reach.following.length ? 'FOLLOWING' : 'ALL');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const itemPrice = typedPrice(price);
  const packChanges = packs.flatMap(pack => {
    const next = typedPrice(packPrices[pack.id] ?? '');
    return next !== null && next !== pack.defaultPrice ? [{ pack, price: next }] : [];
  });
  // Every store gets the price again (and follows it) even when the amount is the same.
  const itemChanged = itemPrice !== null && (itemPrice !== item.defaultPrice || apply === 'ALL');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (itemPrice === null) { setError('Enter the shared price.'); return; }
    if (packs.some(pack => (packPrices[pack.id] ?? '').trim() && typedPrice(packPrices[pack.id]) === null)) { setError('Pack prices must be more than zero, or left as they are.'); return; }
    if (!itemChanged && !packChanges.length) { onClose(); return; }
    setSaving(true); setError('');
    try {
      let latest = item, updated = 0;
      if (itemChanged) {
        const result = (await catalogService.setPrice(item.id, { expectedVersion: latest.version, defaultPrice: itemPrice, apply })).data.data;
        latest = result.item; updated += result.updated;
      }
      for (const change of packChanges) {
        const version = latest.packs.find(pack => pack.id === change.pack.id)?.version ?? change.pack.version;
        const result = (await catalogService.setPackPrice(change.pack.id, { expectedVersion: version, defaultPrice: change.price, apply })).data.data;
        latest = result.item; updated += result.updated;
      }
      toast.success(updated ? `Shared price saved; ${plural(updated, 'store price')} changed` : 'Shared price saved');
      onSaved(latest);
      onClose();
    } catch (failure) {
      setError(apiErrorMessage(failure, 'The price was not saved. Try again.'));
    } finally { setSaving(false); }
  };

  const choice = (value: 'FOLLOWING' | 'ALL', label: string, detail: string) => <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
    <input type="radio" name={formId + '-apply'} className="mt-0.5 h-4 w-4 accent-primary" checked={apply === value} onChange={() => setApply(value)} />
    <span className="min-w-0"><span className="block font-medium">{label}</span><span className="block text-xs text-muted-foreground">{detail}</span></span>
  </label>;

  return <Modal isOpen onClose={() => { if (!saving) onClose(); }} size="md" title="Set Shared Price" description={item.name}
    footer={<DialogActions form={formId} confirmLabel="Save Price" loading={saving} onCancel={onClose} />}>
    <form id={formId} onSubmit={save} className="space-y-4" aria-busy={saving}>
      {error && <Alert tone="error">{error}</Alert>}
      <fieldset disabled={saving} className="min-w-0 space-y-4">
        <Input label="Shared price" type="number" inputMode="decimal" min="0.01" step="0.01" value={price} onChange={event => setPrice(event.target.value)} required
          description={item.defaultPrice === null ? 'This item has no shared price yet.' : `Now ${formatCurrency(item.defaultPrice)}.`} />
        {packs.length > 0 && <FormSection title="Packs" description="Leave a pack's price as it is to keep it.">
          <div className="product-field-grid">
            {packs.map(pack => <Input key={pack.id} label={`${pack.name} (${pack.unitsPerPackage})`} type="number" inputMode="decimal" min="0.01" step="0.01"
              value={packPrices[pack.id] ?? ''} onChange={event => setPackPrices(previous => ({ ...previous, [pack.id]: event.target.value }))}
              description={pack.defaultPrice === null ? 'No shared price yet' : `Now ${formatCurrency(pack.defaultPrice)}`} />)}
          </div>
        </FormSection>}
        <fieldset className="space-y-2">
          <legend className="field-label mb-1.5 text-sm font-medium">Change the price in</legend>
          {choice('FOLLOWING', 'Stores that follow the shared price', reach.following.length ? reach.following.join(', ') : 'No store follows it yet: only the shared price is saved.')}
          {choice('ALL', 'Every store that carries it', `${reach.all.join(', ') || 'No store carries it yet'}. They follow the shared price from now on.`)}
        </fieldset>
      </fieldset>
    </form>
  </Modal>;
}
