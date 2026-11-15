import { useEffect, useId, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { DialogActions } from '@/components/ui/DialogActions';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { ProductPicker } from '@/components/common/ProductPicker';
import { MarginPricing } from '@/components/inventory/MarginPricing';
import { formatCurrency } from '@/lib/utils';
import type { InvoiceLine, InvoiceNewItem } from '@/types/deliveryInvoices';

/** "Which item is this?": the closest items first, then a search of the store's items. */
export function ItemPickerPanel({ line, locationId, onClose, onPick, onAddNew }: {
  line: InvoiceLine | null;
  locationId: string;
  onClose: () => void;
  onPick: (product: { productId: string; sellingUnitId?: string | null }) => void;
  onAddNew: () => void;
}) {
  return <Modal isOpen={!!line} onClose={onClose} title="Which item is this?" size="md" footer={<DialogActions onCancel={onClose} />}
    description={line ? <span className="font-mono text-xs">{line.description}</span> : undefined}>
    {line && <div className="space-y-4">
      {line.candidates.length > 0 && <section aria-labelledby="closest-items" className="space-y-2">
        <h3 id="closest-items" className="text-sm font-medium">Closest items</h3>
        <ul className="space-y-2">
          {line.candidates.map(candidate => <li key={candidate.productId + (candidate.sellingUnitId || '')}>
            <button type="button" aria-pressed={line.product?.productId === candidate.productId && line.product?.sellingUnitId === candidate.sellingUnitId}
              className="block min-h-11 w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-accent aria-pressed:border-primary"
              onClick={() => onPick({ productId: candidate.productId, sellingUnitId: candidate.sellingUnitId })}>
              <span className="font-medium">{candidate.name}</span>
              <span className="block text-xs text-muted-foreground">{candidate.sku}{candidate.unitsPerPackage ? ` · a pack of ${candidate.unitsPerPackage}` : ''}</span>
            </button>
          </li>)}
        </ul>
      </section>}
      <section aria-label="Search your items" className="space-y-2">
        <ProductPicker locationId={locationId} selectedIds={line.product && !line.product.sellingUnitId ? [line.product.productId] : []} onSelect={product => onPick({ productId: product.id })} />
      </section>
      <Button type="button" variant="ghost" onClick={onAddNew}>Not one of my items: add it as new</Button>
    </div>}
  </Modal>;
}

type Form = { name: string; price: string; categoryId: string; barcode: string; minimumAge: '' | '18' | '21'; ebtEligible: boolean; isTaxable: boolean };

const startingForm = (line: InvoiceLine): Form => {
  const item = line.newItem;
  const price = item?.price ?? line.suggestedPrice;
  return {
    name: item?.name ?? line.suggestion?.name ?? line.description,
    price: price ? price.toFixed(2) : '',
    categoryId: item?.categoryId ?? line.suggestion?.categoryId ?? '',
    barcode: item ? item.barcode ?? '' : line.upc ?? '',
    minimumAge: String(item?.minimumAge ?? line.suggestion?.minimumAge ?? '') as Form['minimumAge'],
    ebtEligible: item?.ebtEligible ?? false,
    isTaxable: item?.isTaxable ?? true,
  };
};

/** A new item from an invoice line, filled in from what the invoice says; created when the delivery is received. */
export function NewItemPanel({ line, categories, onClose, onSave }: {
  line: InvoiceLine | null;
  categories: { id: string; name: string }[];
  onClose: () => void;
  onSave: (item: InvoiceNewItem) => Promise<boolean>;
}) {
  const formId = useId();
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(line ? startingForm(line) : null); }, [line]);
  const price = form ? Number(form.price) : NaN;
  const priceOk = !!form?.price.trim() && Number.isFinite(price) && price > 0;
  const set = (patch: Partial<Form>) => setForm(current => current && { ...current, ...patch });

  const submit = async () => {
    if (!form || !priceOk || !form.name.trim()) return;
    setSaving(true);
    const saved = await onSave({ name: form.name.trim(), price: Math.round(price * 100) / 100, categoryId: form.categoryId || null, barcode: form.barcode.trim() || null,
      minimumAge: form.minimumAge ? Number(form.minimumAge) as 18 | 21 : null, ebtEligible: form.ebtEligible, isTaxable: form.isTaxable });
    setSaving(false);
    if (saved) onClose();
  };

  return <Modal isOpen={!!line} onClose={onClose} title="Add a new item" size="md"
    description="It is added to your items when you receive this delivery."
    footer={<DialogActions onCancel={onClose} confirmLabel="Add item" form={formId} loading={saving} disabled={!form || !priceOk || !form.name.trim()} />}>
    {line && form && <form id={formId} className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p className="font-mono text-xs text-muted-foreground">On the invoice: {line.description}</p>
      <Input label="Name" value={form.name} required maxLength={250} onChange={event => set({ name: event.target.value })}
        description="As it should show on the shelf label and the receipt." />
      <Input label="Selling price" type="number" inputMode="decimal" min="0.01" step="0.01" required value={form.price} onChange={event => set({ price: event.target.value })}
        description={line.unitCost !== null ? `Costs ${formatCurrency(line.unitCost)} each on this invoice.` : undefined} />
      {line.unitCost !== null && <MarginPricing categoryId={form.categoryId || undefined} cost={String(line.unitCost)} price={form.price} onPrice={value => set({ price: value })} />}
      <Select label="Category" value={form.categoryId} onChange={event => set({ categoryId: event.target.value })}>
        <option value="">No category</option>
        {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
      </Select>
      <Input label="Barcode" value={form.barcode} maxLength={100} onChange={event => set({ barcode: event.target.value })}
        description="The UPC printed on the invoice, if any. Make sure it is the single item's barcode, not the case's." />
      <Select label="Who may buy it" value={form.minimumAge} onChange={event => set({ minimumAge: event.target.value as Form['minimumAge'] })}
        description={line.suggestion?.ageCheck && !form.minimumAge ? 'This may need an age limit (alcohol, tobacco, vapes).' : undefined}>
        <option value="">Anyone</option>
        <option value="18">18 and over</option>
        <option value="21">21 and over</option>
      </Select>
      <Checkbox label="SNAP/EBT eligible" checked={form.ebtEligible} onChange={event => set({ ebtEligible: event.target.checked })} />
      <Checkbox label="Taxed" checked={form.isTaxable} onChange={event => set({ isTaxable: event.target.checked })} />
    </form>}
  </Modal>;
}
