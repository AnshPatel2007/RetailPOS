import { Checkbox } from '@/components/ui/Checkbox';
import React, { useCallback, useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Boxes, PackageOpen } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ProductPicker } from '@/components/common/ProductPicker';
import { FormSection } from '@/components/common/Workspace';
import { MarginPricing } from '@/components/inventory/MarginPricing';
import { VarietyPackEditor } from '@/components/inventory/VarietyPackEditor';
import { productService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import type { PackagingView } from '@/hooks/useProductPackaging';
import type { Product } from '@/types';
import '@/styles/products.css';

/** What the pack form opens on. */
export type PackFormTarget =
  | { mode: 'create'; kind?: 'PACK' | 'VARIETY'; baseProductId?: string }
  | { mode: 'edit-pack'; productId: string; unitId: string }
  | { mode: 'edit-variety'; productId: string };

interface MergeOffer {
  productId: string; name: string;
  preview: { singlesAdded: number; newBaseStock: number; unopenedPacks: number; costPerSingle: number | null; problems: string[];
    source: { value: number | null; stockQuantity: number }; base: { name: string; baseUnitName: string } } | null;
}

const money = (value: string) => value.trim() === '' ? null : Number(value);
const blankPack = { units: '', name: '', barcode: '', sku: '', price: '', packCost: '' };
const blankVariety = { name: '', barcode: '', sku: '', categoryId: '', price: '', packCost: '', stockQuantity: '0', lowStockAlert: '0',
  isTaxable: true, isActive: true, ebtEligible: false, minimumAge: '' };

/**
 * A pack is managed as a pack. "Pack of one item" (a carton of 10 Marlboro Red,
 * a 12-pack of cans) shares its single's stock and cost: its cost is the
 * single's cost times its count, and entering a pack cost sets the single's
 * cost. A variety pack is its own item whose cost splits by count when opened.
 */
export const PackForm: React.FC<{
  target: PackFormTarget | null; onClose: () => void; onSaved: () => void; categories: { id: string; name: string }[];
}> = ({ target, onClose, onSaved, categories }) => {
  const formId = useId();
  const { locationId } = useEffectiveLocation();
  const [current, setCurrent] = useState<PackFormTarget | null>(target);
  const [kind, setKind] = useState<'PACK' | 'VARIETY' | null>(null);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [base, setBase] = useState<PackagingView | null>(null);
  const [pack, setPack] = useState(blankPack);
  const [costTouched, setCostTouched] = useState(false);
  const [variety, setVariety] = useState(blankVariety);
  const [varietyProduct, setVarietyProduct] = useState<Product | null>(null);
  const [sealedCount, setSealedCount] = useState('');
  const [merge, setMerge] = useState<MergeOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setCurrent(target); setError(''); setMerge(null); setCostTouched(false); setPack(blankPack); setVariety(blankVariety); setVarietyProduct(null);
    setBase(null); setBaseId(null); setSealedCount('');
    if (!target) return;
    if (target.mode === 'create') { setKind(target.kind ?? null); setBaseId(target.baseProductId ?? null); }
    else if (target.mode === 'edit-pack') { setKind('PACK'); setBaseId(target.productId); }
    else setKind('VARIETY');
  }, [target]);

  const loadBase = useCallback(async (id: string) => {
    try {
      const data: PackagingView = (await productService.getSellingUnits(id)).data.data;
      setBase(data);
      return data;
    } catch (err: any) { setError(err.response?.data?.error || 'Could not load the item'); return null; }
  }, []);

  // The single a pack holds: its name, cost and unit name.
  useEffect(() => {
    if (!baseId) return;
    void loadBase(baseId).then(data => {
      if (!data || current?.mode !== 'edit-pack') return;
      const unit = data.sellingUnits.find(candidate => candidate.id === current.unitId);
      if (!unit) { setError('This pack no longer exists'); return; }
      setPack({ units: String(unit.unitsPerPackage), name: unit.name, barcode: unit.barcode, sku: unit.sku || '', price: String(unit.price),
        packCost: (Number(data.cost) * unit.unitsPerPackage).toFixed(2) });
      setSealedCount(String(unit.sealedQuantity));
    });
  }, [baseId, current, loadBase]);

  // A variety pack being edited: its own product record.
  useEffect(() => {
    if (current?.mode !== 'edit-variety') return;
    productService.getById(current.productId).then(res => {
      const product: Product = res.data.data;
      setVarietyProduct(product);
      setVariety({ name: product.name, barcode: product.barcode || '', sku: product.sku, categoryId: product.categoryId || '', price: String(product.price),
        packCost: String(product.cost), stockQuantity: String(product.stockQuantity), lowStockAlert: String(product.lowStockAlert),
        isTaxable: product.isTaxable, isActive: product.isActive, ebtEligible: product.ebtEligible ?? false, minimumAge: product.minimumAge ? String(product.minimumAge) : '' });
    }).catch((err: any) => setError(err.response?.data?.error || 'Could not load the variety pack'));
  }, [current]);

  const unit = base?.baseUnitName && base.baseUnitName !== 'unit' ? base.baseUnitName : 'single';
  const units = Number(pack.units);
  const editingPack = current?.mode === 'edit-pack' ? base?.sellingUnits.find(candidate => candidate.id === current.unitId) ?? null : null;
  const setUnits = (value: string) => setPack(previous => ({ ...previous, units: value,
    // Until a cost is typed, the pack cost follows the single's cost.
    packCost: !costTouched && base && Number(value) >= 2 ? (Number(base.cost) * Number(value)).toFixed(2) : previous.packCost }));
  const pickBase = async (id: string) => {
    setBaseId(id);
    const data = await loadBase(id);
    if (data && !costTouched && units >= 2) setPack(previous => ({ ...previous, packCost: (Number(data.cost) * units).toFixed(2) }));
  };

  const finish = (message: string) => { toast.success(message); onSaved(); onClose(); };

  const savePack = async () => {
    if (!base) { setError('Choose the item this pack holds'); return; }
    const price = Number(pack.price), packCost = money(pack.packCost);
    if (!editingPack && (!Number.isInteger(units) || units < 2)) { setError('A pack holds at least 2 units'); return; }
    if (!pack.barcode.trim()) { setError('Enter the barcode printed on the pack'); return; }
    if (!(price > 0)) { setError('Enter the pack price'); return; }
    if (packCost !== null && !(packCost >= 0)) { setError('Enter the pack cost as a number'); return; }
    const name = pack.name.trim() || `${units}-pack`;
    setBusy(true); setError('');
    try {
      if (editingPack) {
        await productService.updateSellingUnit(base.productId, editingPack.id, { name, barcode: pack.barcode.trim(), sku: pack.sku.trim() || null, price,
          ...(costTouched && packCost !== null ? { packCost } : {}), expectedVersion: editingPack.version });
        finish('Pack saved');
      } else {
        await productService.createSellingUnit(base.productId, { name, barcode: pack.barcode.trim(), sku: pack.sku.trim() || undefined, unitsPerPackage: units, price,
          ...(packCost !== null ? { packCost } : {}) });
        finish('Pack added');
      }
    } catch (err: any) {
      const details = err.response?.data?.details;
      // The barcode belongs to a product of its own (e.g. the carton sold separately): offer to merge it in.
      if (!editingPack && details?.code === 'IDENTIFIER_IN_USE' && details.field === 'barcode' && details.conflict?.kind === 'PRODUCT' && details.conflict.productId !== base.productId) {
        setMerge({ productId: details.conflict.productId, name: details.conflict.name, preview: null });
        try {
          const preview = (await productService.previewMergeIntoPack(details.conflict.productId, { baseProductId: base.productId, unitsPerPackage: units, name, price, barcode: pack.barcode.trim() })).data.data;
          setMerge({ productId: details.conflict.productId, name: details.conflict.name, preview });
        } catch (previewError: any) { setError(previewError.response?.data?.error || 'Could not check the existing product'); }
      } else setError(err.response?.data?.error || 'Could not save the pack');
    } finally { setBusy(false); }
  };

  const confirmMerge = async () => {
    if (!merge || !base) return;
    setBusy(true); setError('');
    try {
      const name = pack.name.trim() || `${units}-pack`;
      const result = (await productService.mergeIntoPack(merge.productId, { baseProductId: base.productId, unitsPerPackage: units, name, price: Number(pack.price),
        barcode: pack.barcode.trim(), idempotencyKey: crypto.randomUUID() })).data.data;
      const packCost = money(pack.packCost);
      if (costTouched && packCost !== null) {
        const fresh: PackagingView = (await productService.getSellingUnits(base.productId)).data.data;
        const created = fresh.sellingUnits.find(candidate => candidate.id === result.merge.sellingUnitId);
        if (created) await productService.updateSellingUnit(base.productId, created.id, { packCost, expectedVersion: created.version });
      }
      finish(`${merge.name} is now the ${name} of ${base.name}`);
    } catch (err: any) { setError(err.response?.data?.error || 'Could not merge the products'); }
    finally { setBusy(false); }
  };

  const changeSealed = async (action: 'count' | 'open', quantity: number) => {
    if (!base || !editingPack) return;
    setBusy(true); setError('');
    try {
      await productService.updatePackaging(base.productId, editingPack.id, { action, quantity, expectedVersion: editingPack.version,
        expectedStockVersion: base.stockVersion, requestKey: crypto.randomUUID(), reason: action === 'open' ? 'Opened onto the shelf' : 'Counted unopened packs' });
      const data = await loadBase(base.productId);
      const updated = data?.sellingUnits.find(candidate => candidate.id === editingPack.id);
      if (updated) setSealedCount(String(updated.sealedQuantity));
      toast.success(action === 'open' ? `Opened one ${editingPack.name}` : 'Unopened count saved');
      onSaved();
    } catch (err: any) { setError(err.response?.data?.error || 'Could not change the unopened count'); }
    finally { setBusy(false); }
  };

  const retire = async () => {
    if (!base || !editingPack) return;
    setBusy(true); setError('');
    try { await productService.updateSellingUnit(base.productId, editingPack.id, { isActive: false, expectedVersion: editingPack.version }); finish(`${editingPack.name} retired`); }
    catch (err: any) { setError(err.response?.data?.error || 'Could not retire the pack'); }
    finally { setBusy(false); }
  };

  const saveVariety = async () => {
    const price = Number(variety.price), cost = money(variety.packCost) ?? 0;
    if (!variety.name.trim()) { setError('Enter the variety pack name'); return; }
    if (!(price > 0)) { setError('Enter the pack price'); return; }
    if (!(cost >= 0)) { setError('Enter the pack cost as a number'); return; }
    const fields = { name: variety.name.trim(), price, cost, isTaxable: variety.isTaxable, isActive: variety.isActive, ebtEligible: variety.ebtEligible,
      minimumAge: variety.minimumAge ? Number(variety.minimumAge) : null, lowStockAlert: Number(variety.lowStockAlert) || 0 };
    setBusy(true); setError('');
    try {
      if (current?.mode === 'edit-variety') {
        await productService.update(current.productId, { ...fields, barcode: variety.barcode.trim() || null, sku: variety.sku.trim() || varietyProduct?.sku,
          categoryId: variety.categoryId || null });
        finish('Variety pack saved');
      } else {
        const sku = variety.sku.trim() || variety.barcode.trim() || `VP-${Date.now().toString(36).toUpperCase()}`;
        const created: Product = (await productService.create({ ...fields, sku, barcode: variety.barcode.trim() || undefined, categoryId: variety.categoryId || undefined,
          trackInventory: true, stockQuantity: Number(variety.stockQuantity) || 0 })).data.data;
        toast.success('Variety pack created. Now list what is inside.');
        onSaved();
        // Stay open on the new pack so its contents can be listed.
        setCurrent({ mode: 'edit-variety', productId: created.id });
      }
    } catch (err: any) { setError(err.response?.data?.error || 'Could not save the variety pack'); }
    finally { setBusy(false); }
  };

  if (!target) return null;
  const title = kind === 'VARIETY' ? (current?.mode === 'edit-variety' ? 'Edit variety pack' : 'Add variety pack')
    : kind === 'PACK' ? (editingPack ? 'Edit pack' : 'Add pack') : 'Add pack';

  return (
    <Modal isOpen onClose={() => { if (!busy) onClose(); }} title={title} size="lg"
      footer={kind && !merge ? <div className="space-y-3">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {editingPack && <Button type="button" variant="outline" className="mr-auto" disabled={busy || editingPack.sealedQuantity > 0} onClick={retire}
            title={editingPack.sealedQuantity > 0 ? 'Open or count the unopened packs first' : 'Stop selling this pack'}>Retire pack</Button>}
          {/* A variety pack's contents save on their own, so its form closes rather than cancels. */}
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{current?.mode === 'edit-variety' ? 'Close' : 'Cancel'}</Button>
          <Button type="submit" form={formId} disabled={busy}>{busy ? 'Saving...' : kind === 'PACK' ? (editingPack ? 'Save pack' : 'Add pack') : current?.mode === 'edit-variety' ? 'Save variety pack' : 'Create variety pack'}</Button>
        </div>
      </div> : undefined}>
      {!kind && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" className="rounded-lg border border-border p-4 text-left hover:bg-accent" onClick={() => setKind('PACK')}>
            <Boxes className="mb-2 h-6 w-6" aria-hidden="true" /><span className="block font-semibold">Pack of one item</span>
            <span className="text-sm text-muted-foreground">A carton, 12-pack or case of the same item. It shares the item's stock and cost.</span>
          </button>
          <button type="button" className="rounded-lg border border-border p-4 text-left hover:bg-accent" onClick={() => setKind('VARIETY')}>
            <PackageOpen className="mb-2 h-6 w-6" aria-hidden="true" /><span className="block font-semibold">Variety pack</span>
            <span className="text-sm text-muted-foreground">Mixed items in one pack, e.g. 12 red, 6 blue and 6 orange. Its cost splits by count when opened.</span>
          </button>
        </div>
      )}

      {kind === 'PACK' && merge && (
        <div className="space-y-4 text-sm">
          <p className="font-medium">{merge.name} already exists as its own product{merge.preview ? ` (${merge.preview.source.stockQuantity} in stock)` : ''}. Merge it into this pack?</p>
          {!merge.preview ? <p role="status">Checking…</p> : merge.preview.problems.length ? (
            <div role="alert" className="space-y-1 text-destructive">{merge.preview.problems.map(problem => <p key={problem}>{problem}</p>)}</div>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              <li>Its {merge.preview.source.stockQuantity} on hand become {merge.preview.singlesAdded} {merge.preview.base.name} ({merge.preview.newBaseStock} in stock afterwards), counted as {merge.preview.unopenedPacks} unopened packs.</li>
              <li>{merge.preview.source.value === null ? 'Their value carries over at the current cost.' : `Their value of ${formatCurrency(merge.preview.source.value)} moves with them${merge.preview.costPerSingle !== null ? ` (${formatCurrency(merge.preview.costPerSingle)} per ${merge.preview.base.baseUnitName})` : ''}. Nothing is gained or lost.`}</li>
              <li>Its barcode and price move to the pack. {merge.name} is archived; its past sales stay in reports.</li>
            </ul>
          )}
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setMerge(null)}>Back</Button>
            <Button type="button" disabled={busy || !merge.preview || merge.preview.problems.length > 0} onClick={confirmMerge}>{busy ? 'Merging...' : 'Merge into this pack'}</Button>
          </div>
        </div>
      )}

      {kind === 'PACK' && !merge && (
        <form id={formId} className="product-form space-y-4" onSubmit={event => { event.preventDefault(); void savePack(); }}>
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            {editingPack || (current?.mode === 'create' && current.baseProductId)
              ? <p className="text-sm">Holds <span className="font-medium">{pack.units || '…'} × {base?.name || '…'}</span>{editingPack ? <span className="text-muted-foreground"> · To change what it holds, retire it and add a new pack.</span> : null}</p>
              : <div className="space-y-2">
                {base ? <p className="text-sm">Holds <span className="font-medium">{base.name}</span> <Button type="button" size="sm" variant="ghost" onClick={() => { setBase(null); setBaseId(null); }}>Change</Button></p>
                  : <ProductPicker locationId={locationId || ''} selectedIds={[]} onSelect={picked => { void pickBase(picked.id); }} />}
              </div>}
            <div className="product-field-grid">
              <Input label={`${unit[0].toUpperCase()}${unit.slice(1)}s in the pack`} type="number" min="2" step="1" value={pack.units} readOnly={!!editingPack}
                onChange={e => setUnits(e.target.value)} required />
              <Input label="Pack name" value={pack.name} onChange={e => setPack({ ...pack, name: e.target.value })} placeholder={units >= 2 ? `${units}-pack` : 'e.g. Carton'} maxLength={60} />
              <Input label="Pack barcode" value={pack.barcode} onChange={e => setPack({ ...pack, barcode: e.target.value })} required maxLength={100} autoComplete="off" />
              <Input label="Pack SKU" description="Optional" value={pack.sku} onChange={e => setPack({ ...pack, sku: e.target.value })} maxLength={100} />
            </div>
            <div className="product-field-grid">
              <Input label="Pack price" type="number" min="0.01" step="0.01" value={pack.price} onChange={e => setPack({ ...pack, price: e.target.value })} required />
              <Input label="Pack cost" type="number" min="0" step="0.01" value={pack.packCost} onChange={e => { setCostTouched(true); setPack({ ...pack, packCost: e.target.value }); }}
                description={units >= 2 && pack.packCost !== '' ? `${formatCurrency(Number(pack.packCost))} ÷ ${units} = ${formatCurrency(Number(pack.packCost) / units)} per ${unit}${costTouched ? ', saved as its cost price' : ''}` : 'What you pay for one pack'} />
            </div>
            {base && <MarginPricing productId={base.productId} cost={pack.packCost} price={pack.price} onPrice={price => setPack(previous => ({ ...previous, price }))} />}
            {editingPack && (
              <FormSection title="Unopened on the shelf" description={`Packs still sealed. Selling a single ${unit} opens one automatically when no loose ones are left.`}>
                <div className="flex flex-wrap items-end gap-2">
                  <Input label="Unopened packs" type="number" min="0" step="1" value={sealedCount} onChange={e => setSealedCount(e.target.value)} className="w-32" />
                  <Button type="button" variant="outline" disabled={busy || sealedCount === '' || Number(sealedCount) === editingPack.sealedQuantity}
                    onClick={() => changeSealed('count', Number(sealedCount))}>Save count</Button>
                  <Button type="button" variant="outline" disabled={busy || editingPack.sealedQuantity < 1} onClick={() => changeSealed('open', 1)}>Open one</Button>
                </div>
              </FormSection>
            )}
            {base && <p className="text-xs text-muted-foreground">Tax, EBT and age checks follow {base.name}. Selling a pack takes {units >= 2 ? units : 'its'} {unit}s from the same stock.</p>}
          </fieldset>
        </form>
      )}

      {kind === 'VARIETY' && (
        <div className="space-y-6">
          <form id={formId} className="product-form space-y-4" onSubmit={event => { event.preventDefault(); void saveVariety(); }}>
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <div className="product-field-grid">
                <Input label="Variety pack name" value={variety.name} onChange={e => setVariety({ ...variety, name: e.target.value })} required maxLength={200} placeholder="e.g. Gatorade Variety 24-pack" />
                <Input label="Barcode" value={variety.barcode} onChange={e => setVariety({ ...variety, barcode: e.target.value })} maxLength={100} autoComplete="off" />
                <Input label="Pack price" type="number" min="0.01" step="0.01" value={variety.price} onChange={e => setVariety({ ...variety, price: e.target.value })} required />
                <Input label="Pack cost" description="What you pay for one pack" type="number" min="0" step="0.01" value={variety.packCost} onChange={e => setVariety({ ...variety, packCost: e.target.value })} />
                {current?.mode === 'edit-variety'
                  ? <p className="self-end pb-2 text-sm">In stock: <span className="font-medium">{variety.stockQuantity}</span> <span className="text-xs text-muted-foreground">(change it with Adjust stock)</span></p>
                  : <Input label="Packs in stock" type="number" min="0" step="1" value={variety.stockQuantity} onChange={e => setVariety({ ...variety, stockQuantity: e.target.value })} />}
                <Select label="Category" value={variety.categoryId} onChange={e => setVariety({ ...variety, categoryId: e.target.value })}>
                  <option value="">No category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                </Select>
              </div>
              <div className="product-choice-grid">
                <Checkbox label="Taxable item" checked={variety.isTaxable} onChange={e => setVariety({ ...variety, isTaxable: e.target.checked })} />
                <Checkbox label="EBT / SNAP eligible" checked={variety.ebtEligible} onChange={e => setVariety({ ...variety, ebtEligible: e.target.checked })} />
                <Checkbox label="Active" checked={variety.isActive} onChange={e => setVariety({ ...variety, isActive: e.target.checked })} />
              </div>
              <Select label="Age restriction" value={variety.minimumAge} onChange={e => setVariety({ ...variety, minimumAge: e.target.value })}>
                <option value="">None</option><option value="18">18+ (lottery)</option><option value="21">21+ (alcohol, tobacco, vape)</option>
              </Select>
            </fieldset>
          </form>
          {current?.mode === 'edit-variety' && varietyProduct
            ? <FormSection title="What's inside" description="List each item and how many are in one pack. The pack's cost splits by count.">
                <VarietyPackEditor product={varietyProduct} onChanged={onSaved} />
              </FormSection>
            : <p className="text-sm text-muted-foreground">After creating the pack, you'll list what's inside it.</p>}
        </div>
      )}
    </Modal>
  );
};
