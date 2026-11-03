import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ProductPicker } from '@/components/common/ProductPicker';
import { productService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import type { Product } from '@/types';

interface BundleView {
  productId: string; stockQuantity: number; packUnitCost: number | null; allocationBasis: 'COST_SHARE' | 'UNIT_COST' | 'EVEN' | null;
  components: { productId: string; name: string; sku: string; quantity: number; costShare: number | null; stockQuantity: number; estimatedValuePerPack: number | null }[];
  partOf: { productId: string; name: string; quantity: number }[];
}
type Line = { productId: string; name: string; quantity: string; share: string };

const BASIS: Record<string, string> = {
  COST_SHARE: 'by the cost shares set below',
  UNIT_COST: "by each product's current cost",
  EVEN: 'evenly per unit (no costs known yet)',
};

/**
 * A variety pack (e.g. an assorted 12-pack) is its own product, bought and sold
 * whole. Listing its contents lets staff open packs: the pack leaves stock and
 * its cost moves into the products inside, so nothing is gained or lost.
 */
export const VarietyPackEditor: React.FC<{ product: Product; onChanged?: () => void }> = ({ product, onChanged }) => {
  const [view, setView] = useState<BundleView | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openQty, setOpenQty] = useState('1');
  const { locationId } = useEffectiveLocation();

  const load = useCallback(async () => {
    try {
      const res = await productService.getBundle(product.id);
      const data: BundleView = res.data.data;
      setView(data);
      setLines(data.components.map(c => ({ productId: c.productId, name: c.name, quantity: String(c.quantity), share: c.costShare === null ? '' : String(Math.round(c.costShare * 10000) / 100) })));
    } catch (err: any) { toast.error(err.response?.data?.error || 'Could not load the pack contents'); }
  }, [product.id]);
  useEffect(() => { load(); }, [load]);

  if (!view) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (view.partOf.length) return <p className="text-sm text-muted-foreground">This product is inside {view.partOf.map(p => p.name).join(', ')}, so it can't be a variety pack itself.</p>;

  const save = async () => {
    const components = lines.map(line => ({ productId: line.productId, quantity: Number(line.quantity), costShare: line.share.trim() ? Number(line.share) / 100 : null }));
    if (components.some(c => !Number.isInteger(c.quantity) || c.quantity < 1)) { toast.error('Each product needs a whole quantity of 1 or more'); return; }
    setBusy(true);
    try {
      const res = await productService.setBundle(product.id, components);
      setView(res.data.data); setEditing(false); toast.success(components.length ? 'Pack contents saved' : 'Pack contents removed'); onChanged?.();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Could not save the pack contents'); }
    finally { setBusy(false); }
  };

  const open = async () => {
    const quantity = Number(openQty);
    if (!Number.isInteger(quantity) || quantity < 1) { toast.error('Open at least one pack'); return; }
    setBusy(true);
    try {
      const res = await productService.openBundle(product.id, { quantity, idempotencyKey: crypto.randomUUID() });
      setView(res.data.data.bundle); setOpenQty('1');
      toast.success(`Opened ${quantity} pack${quantity === 1 ? '' : 's'}; contents added to stock`); onChanged?.();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Could not open the pack'); }
    finally { setBusy(false); }
  };

  const unitsPerPack = view.components.reduce((sum, c) => sum + c.quantity, 0);
  if (!editing) return (
    <div className="space-y-3 text-sm">
      {view.components.length === 0
        ? <p className="text-muted-foreground">Not a variety pack. List its contents if this product is a mixed pack.</p>
        : <>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr><th className="p-2 text-left">Contains</th><th className="p-2 text-right">Per pack</th><th className="p-2 text-right">Cost per pack</th><th className="p-2 text-right">In stock</th></tr></thead>
            <tbody>{view.components.map(c => (
              <tr key={c.productId} className="border-t border-border"><td className="p-2">{c.name}</td><td className="p-2 text-right">{c.quantity}</td>
                <td className="p-2 text-right">{c.estimatedValuePerPack === null ? '—' : formatCurrency(c.estimatedValuePerPack)}{c.costShare !== null ? ` (${Math.round(c.costShare * 1000) / 10}%)` : ''}</td>
                <td className="p-2 text-right">{c.stockQuantity}</td></tr>))}</tbody>
          </table>
          <p className="text-xs text-muted-foreground">{unitsPerPack} units per pack. The pack's cost{view.packUnitCost !== null ? ` (${formatCurrency(view.packUnitCost)})` : ''} is split {BASIS[view.allocationBasis || 'EVEN']}.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Input type="number" label="Packs to open" value={openQty} min="1" step="1" onChange={e => setOpenQty(e.target.value)} className="w-28" />
            <Button type="button" onClick={open} disabled={busy || view.stockQuantity < 1}>Open {openQty || 0} pack{openQty === '1' ? '' : 's'}</Button>
            <span className="text-xs text-muted-foreground">{view.stockQuantity} pack{view.stockQuantity === 1 ? '' : 's'} in stock</span>
          </div>
        </>}
      <Button type="button" variant="outline" onClick={() => setEditing(true)}>{view.components.length ? 'Edit contents' : 'Set contents'}</Button>
    </div>
  );

  return (
    <div className="space-y-3 text-sm">
      {lines.map((line, index) => (
        <div key={line.productId} className="flex flex-wrap items-end gap-2">
          <span className="min-w-[10rem] flex-1 py-2">{line.name}</span>
          <Input type="number" label="Per pack" value={line.quantity} min="1" step="1" className="w-24"
            onChange={e => setLines(current => current.map((l, i) => i === index ? { ...l, quantity: e.target.value } : l))} />
          <Input type="number" label="Cost share %" description="Optional" value={line.share} min="0" max="100" step="0.1" className="w-28"
            onChange={e => setLines(current => current.map((l, i) => i === index ? { ...l, share: e.target.value } : l))} />
          <Button type="button" variant="outline" aria-label={`Remove ${line.name}`} onClick={() => setLines(current => current.filter((_, i) => i !== index))}><Trash2 size={16} /></Button>
        </div>
      ))}
      <ProductPicker locationId={locationId || ''} selectedIds={[product.id, ...lines.map(line => line.productId)]}
        onSelect={picked => setLines(current => current.some(l => l.productId === picked.id) || picked.id === product.id ? current : [...current, { productId: picked.id, name: picked.name, quantity: '1', share: '' }])} />
      <p className="text-xs text-muted-foreground">Leave cost shares empty to split the cost by each product's current cost. If you set them, set every one so they add up to 100%.</p>
      <div className="flex gap-2">
        <Button type="button" onClick={save} disabled={busy}>Save contents</Button>
        <Button type="button" variant="outline" onClick={() => { setEditing(false); load(); }} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
};
