import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, Tags } from 'lucide-react';
import { ManagementPage } from '@/components/common/Workspace';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { pricingService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { formatPercent, priceMetrics } from '@/lib/pricing';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { Spinner } from '@/components/ui/LoadingState';

interface ReviewRow {
  productId: string; sellingUnitId: string | null; name: string; sku: string; price: number; unitCost: number;
  costBasis: 'AVERAGE' | 'LAST_COST' | 'CATALOG'; margin: number | null; targetMargin: number | null; minMargin: number | null;
  ruleSource: string | null; suggestedPrice: number | null; suggestedMargin: number | null; status: 'BELOW_COST' | 'BELOW_MINIMUM' | 'UNDER_TARGET';
}
const STATUS = {
  BELOW_COST: { label: 'Below cost', variant: 'destructive' },
  BELOW_MINIMUM: { label: 'Below minimum', variant: 'warning' },
  UNDER_TARGET: { label: 'Under target', variant: 'secondary' },
} as const;
const BASIS = { AVERAGE: 'average cost', LAST_COST: 'last cost paid', CATALOG: 'cost price' };
const rowKey = (row: ReviewRow) => row.sellingUnitId || row.productId;

/**
 * Items whose price no longer earns their target margin, usually after a
 * delivery changed the cost. Suggested prices round up to the store's price
 * ending. Nothing changes until the owner applies it.
 */
const PriceReview: React.FC = () => {
  const { locationId, isReadOnly } = useEffectiveLocation();
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await pricingService.review(signal);
      const data: ReviewRow[] = res.data.data;
      setRows(data); setError(null);
      setPrices(Object.fromEntries(data.map(row => [rowKey(row), row.suggestedPrice === null ? '' : row.suggestedPrice.toFixed(2)])));
      setSelected(new Set(data.filter(row => row.suggestedPrice !== null).map(rowKey)));
    } catch (err: any) { if (!signal?.aborted) setError(err.response?.data?.error || 'Could not load the price review'); }
  }, []);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load, locationId]);

  const apply = async () => {
    const changes = (rows || []).filter(row => selected.has(rowKey(row)) && Number(prices[rowKey(row)]) > 0)
      .map(row => ({ productId: row.productId, sellingUnitId: row.sellingUnitId, price: Math.round(Number(prices[rowKey(row)]) * 100) / 100, expectedPrice: row.price }));
    if (!changes.length) { toast.error('Select at least one item with a new price'); return; }
    setApplying(true);
    try {
      await pricingService.apply(changes);
      toast.success(`Updated ${changes.length} price${changes.length === 1 ? '' : 's'}`);
      await load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Could not update prices'); }
    finally { setApplying(false); }
  };

  const toggle = (key: string) => setSelected(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  return (
    <ManagementPage>
      <PageHeader title="Price Review" icon={Tags}
        subtitle="Items priced below cost or under their target margin. Prices change only when you apply them."
        actions={rows && rows.length > 0 && !isReadOnly ? <Button onClick={apply} disabled={applying || selected.size === 0}>Apply {selected.size} price{selected.size === 1 ? '' : 's'}</Button> : undefined} />
      {error ? <Card><CardContent className="p-6"><div role="alert"><p>{error}</p><Button className="mt-3" variant="outline" onClick={() => void load()}>Retry</Button></div></CardContent></Card>
        : rows === null ? <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        : rows.length === 0 ? <Card><CardContent className="py-10"><EmptyState icon={CheckCircle2} title="Every price meets its target"
            hint="Items appear here when a price is below cost or below its target margin." action={<Link className="text-sm text-primary hover:underline" to="/settings?section=pricing">Set target margins</Link>} /></CardContent></Card>
        : <Card><CardContent className="pt-5">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-10"><span className="sr-only">Apply</span></TableHead>
              <TableHead>Item</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Target</TableHead><TableHead className="text-right">New price</TableHead>
            </TableRow></TableHeader>
            <TableBody>{rows.map(row => {
              const key = rowKey(row);
              const next = priceMetrics(Number(prices[key]), row.unitCost);
              return (
                <TableRow key={key}>
                  <TableCell><input type="checkbox" aria-label={`Apply new price for ${row.name}`} checked={selected.has(key)} onChange={() => toggle(key)} disabled={isReadOnly} className="h-4 w-4 accent-primary" /></TableCell>
                  <TableCell><div className="font-medium">{row.name}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant={STATUS[row.status].variant}>{STATUS[row.status].label}</Badge>{row.sku}</div></TableCell>
                  <TableCell className="text-right">{formatCurrency(row.unitCost)}<div className="text-xs text-muted-foreground">{BASIS[row.costBasis]}</div></TableCell>
                  <TableCell className="text-right">{formatCurrency(row.price)}</TableCell>
                  <TableCell className="text-right">{formatPercent(row.margin)}</TableCell>
                  <TableCell className="text-right">{formatPercent(row.targetMargin)}{row.ruleSource && <div className="text-xs text-muted-foreground">{row.ruleSource}</div>}</TableCell>
                  <TableCell className="text-right">
                    <input type="number" min="0.01" step="0.01" value={prices[key] ?? ''} aria-label={`New price for ${row.name}`} disabled={isReadOnly}
                      onChange={e => { setPrices(current => ({ ...current, [key]: e.target.value })); setSelected(current => new Set(current).add(key)); }}
                      className="h-9 w-24 rounded-md border border-input bg-background px-2 text-right text-sm" />
                    <div className="text-xs text-muted-foreground">{next ? `${formatPercent(next.margin)} margin` : 'no rule — enter a price'}</div>
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
