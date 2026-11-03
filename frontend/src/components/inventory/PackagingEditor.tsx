import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { productService, supplierService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import type { Product, ProductPackaging, ProductSellingUnit } from '@/types';

/** A supplier case: how the product is bought (e.g. 24 cans for $36). */
export interface SupplierCase {
  supplierId: string; supplierName: string; supplierSku: string | null;
  packSize: number; packCost: number | null; cost: number | null; minOrder: number | null;
}
type Packaging = ProductPackaging & { suppliers?: SupplierCase[] };

const margin = (price: number, cost: number | null) => cost === null || price <= 0 ? null : (price - cost) / price * 100;
const pct = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

/**
 * Connected packaging for one product. The product is the single unit (e.g. a
 * can). Packs sold at the register (a 12-pack) and cases bought from a supplier
 * (24 per case) all draw from and add to the same stock of single units.
 */
export const PackagingEditor: React.FC<{ product: Product; onChanged?: () => void }> = ({ product, onChanged }) => {
  const [data, setData] = useState<Packaging | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [baseName, setBaseName] = useState(product.baseUnitName || 'unit');
  const [pack, setPack] = useState({ name: '', units: '', barcode: '', price: '' });
  const [editing, setEditing] = useState<{ id: string; name: string; barcode: string; price: string; version: number } | null>(null);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [caseForm, setCaseForm] = useState({ supplierId: '', packSize: '', packCost: '', supplierSku: '' });
  const unitCost = product.averageCost ?? (product.cost > 0 ? product.cost : null);

  const load = useCallback(async () => {
    try {
      const res = await productService.getSellingUnits(product.id);
      setData(res.data.data); setBaseName(res.data.data.baseUnitName || 'unit'); setError(null);
    } catch (err: any) { setError(err.response?.data?.error || 'Could not load packaging'); }
  }, [product.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supplierService.getAll({ limit: 200 }).then(res => setSuppliers((res.data.data || []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })))).catch(() => setSuppliers([]));
  }, []);

  const run = async (action: () => Promise<{ data: { data: Packaging } } | unknown>, message: string) => {
    setBusy(true);
    try { const res = await action() as { data?: { data?: Packaging } }; if (res?.data?.data?.sellingUnits) setData(res.data.data); else await load(); toast.success(message); onChanged?.(); return true; }
    catch (err: any) { toast.error(err.response?.data?.error || 'Could not save'); return false; }
    finally { setBusy(false); }
  };

  const addPack = async () => {
    const units = Number(pack.units), price = Number(pack.price);
    if (!pack.name.trim() || !pack.barcode.trim() || !Number.isInteger(units) || units < 2 || !(price > 0)) { toast.error('Enter a name, barcode, units (2 or more) and price'); return; }
    if (await run(() => productService.createSellingUnit(product.id, { name: pack.name.trim(), barcode: pack.barcode.trim(), unitsPerPackage: units, price, baseUnitName: baseName.trim() || undefined }), 'Pack added'))
      setPack({ name: '', units: '', barcode: '', price: '' });
  };
  const saveEdit = async () => {
    if (!editing) return;
    const price = Number(editing.price);
    if (!(price > 0)) { toast.error('Enter a price'); return; }
    if (await run(() => productService.updateSellingUnit(product.id, editing.id, { name: editing.name.trim(), barcode: editing.barcode.trim(), price, expectedVersion: editing.version }), 'Pack updated')) setEditing(null);
  };
  const openOne = (unit: ProductSellingUnit) => data && run(() => productService.updatePackaging(product.id, unit.id, { action: 'open', quantity: 1,
    expectedVersion: unit.version, expectedStockVersion: data.stockVersion, requestKey: crypto.randomUUID(), reason: 'Opened onto the shelf' }), `Opened one ${unit.name}`);
  const retire = (unit: ProductSellingUnit) => run(() => productService.updateSellingUnit(product.id, unit.id, { isActive: false, expectedVersion: unit.version }), `${unit.name} retired`);

  const saveCase = async () => {
    const packSize = Number(caseForm.packSize), packCost = Number(caseForm.packCost);
    if (!caseForm.supplierId || !Number.isInteger(packSize) || packSize < 1 || !(packCost >= 0)) { toast.error('Choose a supplier and enter units per case and case cost'); return; }
    const body = { packSize, packCost, cost: Math.round(packCost / packSize * 10000) / 10000, supplierSku: caseForm.supplierSku.trim() || null };
    const existing = data?.suppliers?.some(s => s.supplierId === caseForm.supplierId);
    if (await run(() => existing ? supplierService.updateProductLink(caseForm.supplierId, product.id, body) : supplierService.linkProduct(caseForm.supplierId, { productId: product.id, ...body }), 'Supplier case saved'))
      setCaseForm({ supplierId: '', packSize: '', packCost: '', supplierSku: '' });
  };

  if (error) return <p role="alert" className="text-sm text-destructive">{error} <Button size="sm" variant="outline" onClick={load}>Retry</Button></p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading packaging…</p>;
  const active = data.sellingUnits.filter(unit => unit.isActive);
  const sealed = active.reduce((sum, unit) => sum + unit.sealedQuantity * unit.unitsPerPackage, 0);
  const formUnits = Number(pack.units), formPrice = Number(pack.price);

  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-3">
        <h4 className="font-semibold">Sold as</h4>
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Single unit is called" value={baseName} onChange={e => setBaseName(e.target.value)} maxLength={30} className="max-w-[12rem]" />
          <Button size="sm" variant="outline" disabled={busy || !baseName.trim() || baseName === data.baseUnitName} onClick={() => run(() => productService.updateBaseUnitName(product.id, baseName.trim()), 'Saved')}>Save name</Button>
        </div>
        <p className="text-muted-foreground">Stock: {data.stockQuantity} {baseName}{data.stockQuantity === 1 ? '' : 's'}
          {active.length > 0 && <> · {active.map(unit => `${unit.sealedQuantity} × ${unit.name} unopened`).join(' · ')} · {data.looseStockQuantity} loose</>}
          {sealed > 0 && <> (all packs come out of the same stock)</>}
        </p>
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-left">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>
              <th className="p-2">Pack</th><th className="p-2 text-right">{baseName}s</th><th className="p-2">Barcode</th><th className="p-2 text-right">Price</th>
              <th className="p-2 text-right">Margin</th><th className="p-2 text-right">Unopened</th><th className="p-2" />
            </tr></thead>
            <tbody>
              <tr className="border-t border-border"><td className="p-2">Single {baseName}</td><td className="p-2 text-right">1</td><td className="p-2">{product.barcode || '—'}</td>
                <td className="p-2 text-right">{formatCurrency(product.price)}</td><td className="p-2 text-right">{pct(margin(product.price, unitCost))}</td><td className="p-2" /><td className="p-2" /></tr>
              {active.map(unit => editing?.id === unit.id ? (
                <tr key={unit.id} className="border-t border-border">
                  <td className="p-2"><Input aria-label="Pack name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></td>
                  <td className="p-2 text-right">{unit.unitsPerPackage}</td>
                  <td className="p-2"><Input aria-label="Pack barcode" value={editing.barcode} onChange={e => setEditing({ ...editing, barcode: e.target.value })} /></td>
                  <td className="p-2"><Input aria-label="Pack price" type="number" step="0.01" min="0.01" value={editing.price} onChange={e => setEditing({ ...editing, price: e.target.value })} /></td>
                  <td className="p-2 text-right">{pct(margin(Number(editing.price), unitCost === null ? null : unitCost * unit.unitsPerPackage))}</td>
                  <td className="p-2 text-right">{unit.sealedQuantity}</td>
                  <td className="p-2 whitespace-nowrap"><Button size="sm" onClick={saveEdit} disabled={busy}>Save</Button> <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button></td>
                </tr>) : (
                <tr key={unit.id} className="border-t border-border">
                  <td className="p-2 font-medium">{unit.name}</td><td className="p-2 text-right">{unit.unitsPerPackage}</td><td className="p-2">{unit.barcode}</td>
                  <td className="p-2 text-right">{formatCurrency(Number(unit.price))}
                    <span className="block text-xs text-muted-foreground">{formatCurrency(Number(unit.price) / unit.unitsPerPackage)} per {baseName}</span></td>
                  <td className="p-2 text-right">{pct(margin(Number(unit.price), unitCost === null ? null : unitCost * unit.unitsPerPackage))}</td>
                  <td className="p-2 text-right">{unit.sealedQuantity}</td>
                  <td className="p-2 whitespace-nowrap">
                    <Button size="sm" variant="outline" disabled={busy || unit.sealedQuantity < 1} onClick={() => openOne(unit)} title="Move one unopened pack onto the shelf as loose units">Open one</Button>{' '}
                    <Button size="sm" variant="outline" onClick={() => setEditing({ id: unit.id, name: unit.name, barcode: unit.barcode, price: String(unit.price), version: unit.version })}>Edit</Button>{' '}
                    <Button size="sm" variant="outline" disabled={busy || unit.sealedQuantity > 0} onClick={() => retire(unit)} title={unit.sealedQuantity > 0 ? 'Open or count the unopened packs first' : 'Stop selling this pack'}>Retire</Button>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-2 sm:grid-cols-5 items-end">
          <Input label="New pack name" placeholder="12-pack" value={pack.name} onChange={e => setPack({ ...pack, name: e.target.value })} maxLength={60} />
          <Input label={`${baseName}s in pack`} type="number" min="2" step="1" value={pack.units} onChange={e => setPack({ ...pack, units: e.target.value })} />
          <Input label="Pack barcode" value={pack.barcode} onChange={e => setPack({ ...pack, barcode: e.target.value })} maxLength={100} />
          <Input label="Pack price" type="number" min="0.01" step="0.01" value={pack.price} onChange={e => setPack({ ...pack, price: e.target.value })}
            description={formUnits >= 2 ? `${formUnits} singles = ${formatCurrency(product.price * formUnits)}` : undefined} />
          <Button onClick={addPack} disabled={busy}>Add pack</Button>
        </div>
        {formUnits >= 2 && formPrice > 0 && <p className="text-xs text-muted-foreground">Pack margin: {pct(margin(formPrice, unitCost === null ? null : unitCost * formUnits))} (a pack can have its own, lower margin than singles).</p>}
      </section>

      <section className="space-y-3">
        <h4 className="font-semibold">Bought as</h4>
        {(data.suppliers || []).length === 0 ? <p className="text-muted-foreground">No supplier case set. Add one so purchase orders and reorder suggestions use whole cases.</p> :
          <ul className="space-y-1">{data.suppliers!.map(s => (
            <li key={s.supplierId} className="flex flex-wrap justify-between gap-2 rounded border border-border px-3 py-2">
              <span><span className="font-medium">{s.supplierName}</span>{s.supplierSku ? <span className="text-xs text-muted-foreground"> · {s.supplierSku}</span> : null}</span>
              <span>{s.packSize > 1 ? `Case of ${s.packSize}` : 'Single units'}{s.packCost !== null ? ` · ${formatCurrency(Number(s.packCost))} per case` : ''}
                {s.cost !== null ? ` · ${formatCurrency(Number(s.cost))} per ${baseName}` : ''}</span>
              <Button size="sm" variant="outline" onClick={() => setCaseForm({ supplierId: s.supplierId, packSize: String(s.packSize), packCost: s.packCost === null ? '' : String(s.packCost), supplierSku: s.supplierSku || '' })}>Edit</Button>
            </li>))}</ul>}
        <div className="grid gap-2 sm:grid-cols-5 items-end">
          <Select label="Supplier" value={caseForm.supplierId} onChange={e => setCaseForm({ ...caseForm, supplierId: e.target.value })}>
            <option value="">Choose…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input label={`${baseName}s per case`} type="number" min="1" step="1" value={caseForm.packSize} onChange={e => setCaseForm({ ...caseForm, packSize: e.target.value })} />
          <Input label="Case cost" type="number" min="0" step="0.01" value={caseForm.packCost} onChange={e => setCaseForm({ ...caseForm, packCost: e.target.value })}
            description={Number(caseForm.packSize) > 0 && caseForm.packCost !== '' ? `${formatCurrency(Number(caseForm.packCost) / Number(caseForm.packSize))} per ${baseName}` : undefined} />
          <Input label="Supplier item # (optional)" value={caseForm.supplierSku} onChange={e => setCaseForm({ ...caseForm, supplierSku: e.target.value })} maxLength={100} />
          <Button onClick={saveCase} disabled={busy}>Save case</Button>
        </div>
      </section>
    </div>
  );
};
