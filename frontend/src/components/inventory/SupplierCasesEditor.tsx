import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { supplierService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import type { PackagingView } from '@/hooks/useProductPackaging';

const EMPTY = { supplierId: '', packSize: '', packCost: '', supplierSku: '' };

/**
 * How an item is bought: each supplier's case size and case cost (e.g. 24 cans
 * for $36 = $1.50 a can). Purchase orders and reorder suggestions use whole cases.
 */
export const SupplierCasesEditor: React.FC<{ data: PackagingView | null; onChanged: () => void; disabled?: boolean }> = ({ data, onChanged, disabled }) => {
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supplierService.getAll({ limit: 100 }).then(res => setSuppliers((res.data.data || []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })))).catch(() => setSuppliers([]));
  }, []);
  if (!data) return <p className="text-sm text-muted-foreground">Loading suppliers…</p>;
  const unit = data.baseUnitName || 'unit';
  const cases = data.suppliers || [];
  const packSizes = [...new Set(data.sellingUnits.filter(u => u.isActive).map(u => u.unitsPerPackage))];

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await action(); toast.success(message); onChanged(); return true; }
    catch (err: any) { toast.error(err.response?.data?.error || 'Could not save'); return false; }
    finally { setBusy(false); }
  };
  const save = async () => {
    const packSize = Number(form.packSize), packCost = Number(form.packCost);
    if (!form.supplierId || !Number.isInteger(packSize) || packSize < 1 || form.packCost === '' || !(packCost >= 0)) { toast.error('Choose a supplier and enter units per case and case cost'); return; }
    const body = { packSize, packCost, cost: Math.round(packCost / packSize * 10000) / 10000, supplierSku: form.supplierSku.trim() || null };
    const existing = cases.some(s => s.supplierId === form.supplierId);
    if (await run(() => existing ? supplierService.updateProductLink(form.supplierId, data.productId, body) : supplierService.linkProduct(form.supplierId, { productId: data.productId, ...body }), 'Supplier case saved'))
      setForm(EMPTY);
  };

  return (
    <div className="space-y-3 text-sm" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
      {cases.length === 0 ? <p className="text-muted-foreground">No supplier set. Add one so purchase orders and reorder suggestions use whole cases.</p> :
        <ul className="space-y-1">{cases.map(s => (
          <li key={s.supplierId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
            <span><span className="font-medium">{s.supplierName}</span>{s.supplierSku ? <span className="text-xs text-muted-foreground"> · {s.supplierSku}</span> : null}</span>
            <span className="text-xs text-muted-foreground">{s.packSize > 1 ? `Case of ${s.packSize}` : `Single ${unit}s`}{s.packCost !== null ? ` · ${formatCurrency(Number(s.packCost))} per case` : ''}
              {s.cost !== null ? ` · ${formatCurrency(Number(s.cost))} per ${unit}` : ''}</span>
            <span className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setForm({ supplierId: s.supplierId, packSize: String(s.packSize), packCost: s.packCost === null ? '' : String(s.packCost), supplierSku: s.supplierSku || '' })}>Edit</Button>
              <Button type="button" size="sm" variant="outline" disabled={disabled || busy} aria-label={`Remove ${s.supplierName}`}
                onClick={() => run(() => supplierService.unlinkProduct(s.supplierId, data.productId), `${s.supplierName} removed`)}>Remove</Button>
            </span>
          </li>))}</ul>}
      <div className="grid items-end gap-2 sm:grid-cols-5">
        <Select label="Supplier" value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })}>
          <option value="">Choose…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Input label={`${unit}s per case`} type="number" min="1" step="1" value={form.packSize} onChange={e => setForm({ ...form, packSize: e.target.value })} list={`case-sizes-${data.productId}`} />
        <datalist id={`case-sizes-${data.productId}`}>{packSizes.map(size => <option key={size} value={size} />)}</datalist>
        <Input label="Case cost" type="number" min="0" step="0.01" value={form.packCost} onChange={e => setForm({ ...form, packCost: e.target.value })}
          description={Number(form.packSize) > 0 && form.packCost !== '' ? `${formatCurrency(Number(form.packCost) / Number(form.packSize))} per ${unit}` : undefined} />
        <Input label="Supplier item # (optional)" value={form.supplierSku} onChange={e => setForm({ ...form, supplierSku: e.target.value })} maxLength={100} />
        <Button type="button" onClick={save} disabled={disabled || busy}>Save case</Button>
      </div>
    </div>
  );
};
