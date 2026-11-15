import { useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { DialogActions } from '@/components/ui/DialogActions';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { useConfirm } from '@/components/ui/useConfirm';
import { FormSection } from '@/components/common/Workspace';
import { apiErrorMessage, catalogService, categoryService } from '@/services/api';
import { changedFields, draftOf, draftProblem, plural, SharedDraft } from '@/lib/sharedCatalog';
import { formatCurrency } from '@/lib/utils';
import type { CatalogItem } from '@/types/sharedCatalog';

/**
 * Edit a shared item once for every store that carries it: name, SKU, barcode, category
 * and selling rules. Stock, cost and each store's own price never change here. A clash
 * in one store (an SKU or barcode it already uses) refuses the whole change and names it.
 */
export function CatalogItemPanel({ item, onClose, onSaved }: { item: CatalogItem; onClose: () => void; onSaved: (item: CatalogItem) => void }) {
  const formId = useId();
  const [confirm, confirmDialog] = useConfirm();
  const [current, setCurrent] = useState(item);
  const [draft, setDraft] = useState<SharedDraft>(() => draftOf(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; stale: boolean } | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => {
    const request = new AbortController();
    categoryService.getAll(undefined, request.signal).then(response => setCategories((response.data.data || []).map((category: { name: string }) => category.name))).catch(() => undefined);
    return () => request.abort();
  }, []);
  const set = <K extends keyof SharedDraft>(key: K, value: SharedDraft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const changes = changedFields(current, draft);
  const changedCount = Object.keys(changes).length;

  const reload = async () => {
    try {
      const fresh = (await catalogService.get(current.id)).data.data;
      setCurrent(fresh); setDraft(draftOf(fresh)); setError(null);
      onSaved(fresh);
    } catch (failure) { setError({ text: apiErrorMessage(failure, 'Could not reload the item. Try again.'), stale: true }); }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = draftProblem(draft);
    if (problem) { setError({ text: problem, stale: false }); return; }
    if (!changedCount) { onClose(); return; }
    setSaving(true); setError(null);
    try {
      const saved = (await catalogService.update(current.id, current.version, changes)).data.data;
      toast.success(`${saved.name} changed in ${plural(saved.listings.length, 'store')}`);
      onSaved(saved);
      onClose();
    } catch (failure) {
      const status = (failure as { response?: { status?: number } }).response?.status;
      const text = apiErrorMessage(failure, 'The item was not saved. Your changes are still here. Try again.');
      setError({ text, stale: status === 409 && /Someone else changed/.test(text) });
    } finally { setSaving(false); }
  };

  const unlink = async (listing: CatalogItem['listings'][number]) => {
    const ok = await confirm({ title: `Unlink ${current.name} at ${listing.storeName}?`, confirmLabel: 'Unlink', destructive: true,
      message: `${listing.storeName} keeps the item, its stock and its price, but it stops changing with the shared item and becomes the store's own.` });
    if (!ok) return;
    try {
      const fresh = (await catalogService.unlink(current.id, listing.productId)).data.data;
      setCurrent(fresh);
      onSaved(fresh);
      toast.success(`${listing.storeName} now keeps its own ${fresh.name}`);
    } catch (failure) { toast.error(apiErrorMessage(failure, 'Could not unlink it. Try again.')); }
  };

  const ages = ['18', '21', ...(draft.minimumAge && !['18', '21'].includes(draft.minimumAge) ? [draft.minimumAge] : [])];
  return <Modal isOpen onClose={() => { if (!saving) onClose(); }} size="lg" title="Edit Shared Item"
    description={`Changes reach every store that carries it (${plural(current.listings.length, 'store')}). Stock, cost and store prices stay as they are.`}
    footer={<DialogActions form={formId} confirmLabel={changedCount ? `Save ${plural(changedCount, 'change')}` : 'Save'} loading={saving} onCancel={onClose} />}>
    {confirmDialog}
    <form id={formId} onSubmit={save} className="space-y-4" aria-busy={saving}>
      {error && <Alert tone="error" action={error.stale ? <Button type="button" variant="outline" onClick={() => void reload()}>Reload</Button> : undefined}>{error.text}</Alert>}
      <fieldset disabled={saving} className="min-w-0 product-form">
        <FormSection title="Basics">
          <div className="space-y-4">
            <Input label="Name" value={draft.name} onChange={event => set('name', event.target.value)} maxLength={250} required />
            <div className="product-field-grid">
              <Input label="SKU" value={draft.sku} onChange={event => set('sku', event.target.value)} maxLength={100} required />
              <Input label="Barcode" value={draft.barcode} onChange={event => set('barcode', event.target.value)} maxLength={100} autoComplete="off" />
            </div>
            <div className="product-field-grid">
              <Input label="Category" value={draft.categoryName} onChange={event => set('categoryName', event.target.value)} maxLength={100} list={formId + '-categories'}
                description="A store without this category gets it." />
              <Input label="One unit is called" value={draft.baseUnitName} onChange={event => set('baseUnitName', event.target.value)} maxLength={40} description='For example "can" or "bottle".' />
            </div>
            <datalist id={formId + '-categories'}>{categories.map(name => <option key={name} value={name} />)}</datalist>
          </div>
        </FormSection>
        <FormSection title="Selling rules">
          <div className="space-y-4">
            <div className="product-choice-grid">
              <Checkbox label="Taxable item" checked={draft.isTaxable} onChange={event => set('isTaxable', event.target.checked)} />
              <Checkbox label="EBT / SNAP eligible" checked={draft.ebtEligible} onChange={event => set('ebtEligible', event.target.checked)} />
              <Checkbox label="Price-embedded barcode" checked={draft.priceEmbedded} onChange={event => set('priceEmbedded', event.target.checked)} />
            </div>
            <Select label="Age restriction" value={draft.minimumAge} onChange={event => set('minimumAge', event.target.value)}>
              <option value="">None</option>
              {ages.map(age => <option key={age} value={age}>{age === '18' ? '18+ (lottery)' : age === '21' ? '21+ (alcohol, tobacco, vape)' : `${age}+`}</option>)}
            </Select>
            <Input label="Sale hold" value={draft.saleBlockedReason} onChange={event => set('saleBlockedReason', event.target.value)} maxLength={200}
              description="Optional. A recall or prohibited-sale reason; every store's register refuses the item while it is set." />
          </div>
        </FormSection>
        <FormSection collapsible title="Brand, size & description" summary={[draft.brand.trim(), draft.size.trim()].filter(Boolean).join(' · ') || undefined}>
          <div className="space-y-4">
            <div className="product-field-grid">
              <Input label="Brand" value={draft.brand} onChange={event => set('brand', event.target.value)} maxLength={100} />
              <Input label="Product family" value={draft.productFamily} onChange={event => set('productFamily', event.target.value)} maxLength={100} />
              <Input label="Flavor / variant" value={draft.variant} onChange={event => set('variant', event.target.value)} maxLength={100} />
              <Input label="Size" value={draft.size} onChange={event => set('size', event.target.value)} maxLength={100} />
            </div>
            <Input label="Description" value={draft.description} onChange={event => set('description', event.target.value)} maxLength={2000} />
          </div>
        </FormSection>
      </fieldset>
      <FormSection title="Stores" description="Each store's own price and stock. Unlinking makes the store's item its own again.">
        <ul className="divide-y rounded-md border">
          {current.listings.map(listing => <li key={listing.productId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 font-medium">{listing.storeName}</span>
            <span className="tabular-nums">{formatCurrency(listing.price)}</span>
            {listing.priceFollowsCatalog ? <Badge variant="success">Follows shared price</Badge> : <Badge variant="secondary">Own price</Badge>}
            <span className="text-muted-foreground">{listing.stockQuantity} in stock</span>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => void unlink(listing)} aria-label={`Unlink ${current.name} at ${listing.storeName}`}>Unlink</Button>
          </li>)}
          {current.missingStores.map(store => <li key={store.locationId} className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
            <span className="flex-1">{store.storeName}</span><span>Not carried</span>
          </li>)}
        </ul>
      </FormSection>
    </form>
  </Modal>;
}
