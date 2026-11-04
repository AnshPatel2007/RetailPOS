import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { productService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import type { PackagingView } from '@/hooks/useProductPackaging';
import type { ProductSellingUnit } from '@/types';

/**
 * The packs of one single item (e.g. its carton of 10), shown on the single's
 * form. Packs are added and edited in their own pack form; this only lists them.
 */
export const ProductPacksSection: React.FC<{
  data: PackagingView | null; error: string | null; onReload: () => void;
  onAddPack: () => void; onEditPack: (unit: ProductSellingUnit) => void; disabled?: boolean;
}> = ({ data, error, onReload, onAddPack, onEditPack, disabled }) => {
  const [baseName, setBaseName] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setBaseName(data?.baseUnitName || 'unit'); }, [data?.baseUnitName]);

  if (error) return <p role="alert" className="text-sm text-destructive">{error} <Button type="button" size="sm" variant="outline" onClick={onReload}>Retry</Button></p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading packs…</p>;
  const packs = data.sellingUnits.filter(unit => unit.isActive);
  const unitCost = Number(data.cost);

  const saveName = async () => {
    setSaving(true);
    try { await productService.updateBaseUnitName(data.productId, baseName.trim()); toast.success('Saved'); onReload(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-3 text-sm">
      {packs.length === 0
        ? <p className="text-muted-foreground">Not sold in packs yet. Add one if you also sell a carton, 12-pack or case of this item.</p>
        : <ul className="space-y-2">{packs.map(unit => (
          <li key={unit.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
            <span><span className="font-medium">{unit.name}</span>
              <span className="text-xs text-muted-foreground"> · {unit.unitsPerPackage} {data.baseUnitName}s · {unit.barcode}</span></span>
            <span className="text-xs text-muted-foreground">
              Price {formatCurrency(Number(unit.price))} · Pack cost {formatCurrency(unitCost * unit.unitsPerPackage)} · {unit.sealedQuantity} unopened
            </span>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onEditPack(unit)}>Edit pack</Button>
          </li>))}</ul>}
      <Button type="button" variant="outline" disabled={disabled} onClick={onAddPack}>Add a pack of this item</Button>
      <div className="flex flex-wrap items-end gap-2 pt-2" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
        <Input label="Each one is called" description="Used in pack counts, e.g. can, bottle, pack" value={baseName} onChange={e => setBaseName(e.target.value)} maxLength={30} className="w-48" />
        <Button type="button" size="sm" variant="outline" disabled={disabled || saving || !baseName.trim() || baseName === data.baseUnitName} onClick={saveName}>Save name</Button>
      </div>
    </div>
  );
};
