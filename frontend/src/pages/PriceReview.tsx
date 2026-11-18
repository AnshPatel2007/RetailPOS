import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2 } from 'lucide-react';
import { ManagementPage } from '@/components/common/Workspace';
import { PageHeader } from '@/components/common/PageHeader';
import { ProductTabs } from '@/components/common/WorkflowNavigation';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { apiErrorMessage, catalogService, pricingService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { formatPercent, priceMetrics } from '@/lib/pricing';
import { typedPrice } from '@/lib/sharedCatalog';
import { managesSharedCatalog } from '@/lib/navigation';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useAuthStore } from '@/store/authStore';
import { useConfirm } from '@/components/ui/useConfirm';
import { Spinner } from '@/components/ui/LoadingState';
import { Alert } from '@/components/ui/Alert';
import { LabelTarget, ShelfLabelsDialog } from '@/components/inventory/ShelfLabelsDialog';

interface ReviewRow {
  productId: string; sellingUnitId: string | null; name: string; sku: string; price: number; unitCost: number;
  costBasis: 'AVERAGE' | 'LAST_COST' | 'CATALOG'; margin: number | null; targetMargin: number | null; minMargin: number | null;
  ruleSource: string | null; suggestedPrice: number | null; suggestedMargin: number | null; status: 'BELOW_COST' | 'BELOW_MINIMUM' | 'UNDER_TARGET';
  /** Shared catalog: the price follows the shared price, so it is set there (an owner may set it for every store from here). */
  priceFollowsCatalog?: boolean; catalogItemId?: string | null; catalogPackId?: string | null;
}
const STATUS = {
  BELOW_COST: { label: 'Below cost', variant: 'destructive' },
  BELOW_MINIMUM: { label: 'Below minimum', variant: 'warning' },
  UNDER_TARGET: { label: 'Under target', variant: 'secondary' },
} as const;
const BASIS = { AVERAGE: 'average cost', LAST_COST: 'last cost paid', CATALOG: 'cost price' };
const rowKey = (row: ReviewRow) => row.sellingUnitId || row.productId;
const follows = (row: ReviewRow) => !!row.priceFollowsCatalog;
/** A following price an owner can set for every store from here: the item, or a shared pack. */
const sharedTarget = (row: ReviewRow) => follows(row) && !!row.catalogItemId && (!row.sellingUnitId || !!row.catalogPackId);

/**
 * Items whose price no longer earns their target margin, usually after a
 * delivery changed the cost. Suggested prices round up to the store's price
 * ending. Nothing changes until the owner applies it.
 */
const PriceReview: React.FC = () => {
  const { locationId, isReadOnly } = useEffectiveLocation();
  const ownsCatalog = useAuthStore(state => managesSharedCatalog(state.user)) && !isReadOnly;
  const [confirm, confirmDialog] = useConfirm();
  const [sharing, setSharing] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  // The items whose prices were just applied: their shelf labels now show the old price.
  const [applied, setApplied] = useState<LabelTarget[] | null>(null);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await pricingService.review(signal);
      const data: ReviewRow[] = res.data.data;
      setRows(data); setError(null);
      setPrices(Object.fromEntries(data.map(row => [rowKey(row), row.suggestedPrice === null ? '' : row.suggestedPrice.toFixed(2)])));
      // A price that follows the shared one is not this store's to apply.
      setSelected(new Set(data.filter(row => row.suggestedPrice !== null && !follows(row)).map(rowKey)));
    } catch (err: any) { if (!signal?.aborted) setError(err.response?.data?.error || 'Could not load the price review'); }
  }, []);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load, locationId]);

  const apply = async () => {
    const changes = (rows || []).filter(row => !follows(row) && selected.has(rowKey(row)) && Number(prices[rowKey(row)]) > 0)
      .map(row => ({ productId: row.productId, sellingUnitId: row.sellingUnitId, price: Math.round(Number(prices[rowKey(row)]) * 100) / 100, expectedPrice: row.price }));
    if (!changes.length) { toast.error('Select at least one item with a new price'); return; }
    setApplying(true);
    try {
      const result: { applied: number; followingSharedPrice?: { productId: string; sellingUnitId: string | null }[] } = (await pricingService.apply(changes)).data.data;
      // Items that started following the shared price since the review loaded keep it.
      const kept = result.followingSharedPrice ?? [];
      const keptKey = (entry: { productId: string; sellingUnitId?: string | null }) => entry.sellingUnitId || entry.productId;
      toast.success(`Updated ${result.applied} price${result.applied === 1 ? '' : 's'}`);
      if (kept.length) toast(`${kept.length} item${kept.length === 1 ? ' follows' : 's follow'} the shared price and kept ${kept.length === 1 ? 'its' : 'their'} price.`);
      const changed = changes.filter(change => !kept.some(entry => keptKey(entry) === keptKey(change)));
      if (changed.length) setApplied(changed.map(change => ({ productId: change.productId, sellingUnitId: change.sellingUnitId ?? null })));
      await load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Could not update prices'); }
    finally { setApplying(false); }
  };

  /** An owner sets the shared price for every store from a following row: the item's or its shared pack's. */
  const applyShared = async (row: ReviewRow) => {
    const key = rowKey(row), price = typedPrice(prices[key] ?? '');
    if (!row.catalogItemId || price === null) { toast.error('Enter the new price first'); return; }
    const ok = await confirm({ title: `Set ${row.name} to ${formatCurrency(price)} in every store?`, confirmLabel: 'Apply to all stores',
      message: 'This is the shared price: every store that carries it changes to it and follows the shared price from now on.' });
    if (!ok) return;
    setSharing(key);
    try {
      const item = (await catalogService.get(row.catalogItemId)).data.data;
      if (row.catalogPackId) {
        const pack = item.packs.find(entry => entry.id === row.catalogPackId);
        if (!pack) { toast.error('This pack is no longer shared. Reload the review.'); return; }
        await catalogService.setPackPrice(pack.id, { expectedVersion: pack.version, defaultPrice: price, apply: 'ALL' });
      } else await catalogService.setPrice(item.id, { expectedVersion: item.version, defaultPrice: price, apply: 'ALL' });
      toast.success(`${row.name} is ${formatCurrency(price)} in every store`);
      setApplied([{ productId: row.productId, sellingUnitId: row.sellingUnitId ?? null }]);
      await load();
    } catch (err) { toast.error(apiErrorMessage(err, 'Could not set the shared price. Try again.')); }
    finally { setSharing(null); }
  };

  const toggle = (key: string) => setSelected(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const ownRows = (rows || []).filter(row => !follows(row));
  const chosen = ownRows.filter(row => selected.has(rowKey(row))).length;

  return (
    <ManagementPage>
      {confirmDialog}
      <PageHeader title="Products" tabs={<ProductTabs value="price-review" />}
        actions={ownRows.length > 0 && !isReadOnly ? <Button variant="primary" onClick={apply} loading={applying} disabled={chosen === 0 || sharing !== null}>Apply {chosen} price{chosen === 1 ? '' : 's'}</Button> : undefined} />
      {applied && <Alert tone="success" title={`New prices for ${applied.length} item${applied.length === 1 ? '' : 's'}`}
        action={<div className="flex flex-wrap gap-2"><Button variant="primary" onClick={() => setPrinting(true)}>Print labels for these items</Button>
          <Button variant="ghost" onClick={() => setApplied(null)}>Later</Button></div>}>
        Their shelf labels still show the old price. They stay under the Labels button on Products until printed.
      </Alert>}
      <ShelfLabelsDialog isOpen={printing && !!applied} only={applied || undefined} onClose={() => { setPrinting(false); setApplied(null); }} />
      {error ? <Card><CardContent className="p-6"><div role="alert"><p>{error}</p><Button className="mt-3" variant="outline" onClick={() => void load()}>Retry</Button></div></CardContent></Card>
        : rows === null ? <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        : rows.length === 0 ? <Card><CardContent className="py-10"><EmptyState icon={CheckCircle2} title="Every price meets its target"
            hint="Items appear here when a price is below cost or below its target margin." action={<Link className="text-sm text-primary hover:underline" to="/settings?section=pricing">Set target margins</Link>} /></CardContent></Card>
        : <Card><CardContent className="pt-5">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-10"><input type="checkbox" aria-label="Select every item" disabled={isReadOnly || !ownRows.length}
                checked={ownRows.length > 0 && ownRows.every(row => selected.has(rowKey(row)))}
                onChange={e => setSelected(e.target.checked ? new Set(ownRows.map(rowKey)) : new Set())} className="h-4 w-4 accent-primary" /></TableHead>
              <TableHead>Item</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Target</TableHead><TableHead className="text-right">New price</TableHead>
            </TableRow></TableHeader>
            <TableBody>{rows.map(row => {
              const key = rowKey(row);
              const next = priceMetrics(Number(prices[key]), row.unitCost);
              const shared = follows(row), ownerSets = shared && ownsCatalog && sharedTarget(row);
              return (
                <TableRow key={key}>
                  <TableCell><input type="checkbox" aria-label={shared ? `${row.name} follows the shared price` : `Apply new price for ${row.name}`}
                    checked={!shared && selected.has(key)} onChange={() => toggle(key)} disabled={isReadOnly || shared} className="h-4 w-4 accent-primary" /></TableCell>
                  <TableCell><div className="font-medium">{row.name}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant={STATUS[row.status].variant}>{STATUS[row.status].label}</Badge>
                      {shared && <Badge>Shared price</Badge>}{row.sku}</div></TableCell>
                  <TableCell className="text-right">{formatCurrency(row.unitCost)}<div className="text-xs text-muted-foreground">{BASIS[row.costBasis]}</div></TableCell>
                  <TableCell className="text-right">{formatCurrency(row.price)}</TableCell>
                  <TableCell className="text-right">{formatPercent(row.margin)}</TableCell>
                  <TableCell className="text-right">{formatPercent(row.targetMargin)}{row.ruleSource && <div className="text-xs text-muted-foreground">{row.ruleSource}</div>}</TableCell>
                  <TableCell className="text-right">
                    {shared && !ownerSets
                      ? <div className="text-xs text-muted-foreground">{row.suggestedPrice !== null && <div>Suggested {formatCurrency(row.suggestedPrice)}</div>}The owner sets it in the Shared Catalog</div>
                      : <>
                        <input type="number" min="0.01" step="0.01" value={prices[key] ?? ''} aria-label={`New price for ${row.name}`} disabled={isReadOnly || sharing === key}
                          onChange={e => { setPrices(current => ({ ...current, [key]: e.target.value })); if (!shared) setSelected(current => new Set(current).add(key)); }}
                          className="h-9 w-24 rounded-md border border-input bg-background px-2 text-right text-sm" />
                        <div className="text-xs text-muted-foreground">{next ? `${formatPercent(next.margin)} margin` : 'no rule — enter a price'}</div>
                        {ownerSets && <Button variant="outline" className="mt-1" loading={sharing === key} disabled={sharing !== null || applying}
                          onClick={() => void applyShared(row)} aria-label={`Apply the new price of ${row.name} to all stores`}>Apply to all stores</Button>}
                      </>}
                  </TableCell>
                </TableRow>
              );
            })}</TableBody>
          </Table>
        </CardContent></Card>}
    </ManagementPage>
  );
};

export default PriceReview;
