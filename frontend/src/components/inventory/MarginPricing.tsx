import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { pricingService, PriceRounding } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { formatPercent, priceForMargin, priceMetrics } from '@/lib/pricing';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

interface Rule { source: string; targetMargin: number; minMargin: number | null; rounding: PriceRounding }

/**
 * Two-way pricing: type a price to see its margin, or type a margin to get a
 * price (rounded up to the store's price ending). Uses the average cost of
 * stock on hand when known. Never shown at checkout.
 */
export const MarginPricing: React.FC<{
  productId?: string; categoryId?: string; brand?: string;
  cost: string; averageCost?: number | null; price: string; onPrice: (price: string) => void;
}> = ({ productId, categoryId, brand, cost, averageCost, price, onPrice }) => {
  const unitCost = averageCost != null && averageCost > 0 ? averageCost : parseFloat(cost);
  const costLabel = averageCost != null && averageCost > 0 ? 'average cost of stock on hand' : 'cost price';
  const priceValue = parseFloat(price);
  const metrics = priceMetrics(priceValue, unitCost);
  const [rule, setRule] = useState<Rule | null>(null);
  const [marginInput, setMarginInput] = useState('');
  const key = useDebouncedValue(`${productId || ''}|${categoryId || ''}|${brand || ''}`);

  useEffect(() => {
    const controller = new AbortController();
    const [id, category, brandName] = key.split('|');
    pricingService.suggest({ ...(id ? { productId: id } : {}), ...(category ? { categoryId: category } : {}), ...(brandName ? { brand: brandName } : {}) }, controller.signal)
      .then(res => setRule(res.data.data.rule))
      .catch(() => { /* pricing rules are optional */ });
    return () => controller.abort();
  }, [key]);

  const suggested = rule && unitCost > 0 ? priceForMargin(unitCost, rule.targetMargin, rule.rounding) : null;
  const applyMargin = (value: string) => {
    setMarginInput(value);
    const next = priceForMargin(unitCost, parseFloat(value) / 100, rule?.rounding || 'CENT');
    if (next !== null) onPrice(next.toFixed(2));
  };

  if (!(unitCost > 0)) return <p className="text-xs text-muted-foreground">Enter a cost to see the margin and a suggested price.</p>;
  return (
    <div className="space-y-2 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Set price by margin (%)
          <input type="number" min="0" max="99.9" step="0.1" value={marginInput} onChange={e => applyMargin(e.target.value)}
            className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm" aria-describedby="margin-pricing-help" placeholder={rule ? String(Math.round(rule.targetMargin * 1000) / 10) : '30'} />
        </label>
        {suggested !== null && (
          <button type="button" className="h-9 rounded-md border border-input px-3 text-xs hover:bg-accent" onClick={() => { setMarginInput(''); onPrice(suggested.toFixed(2)); }}>
            Use suggested {formatCurrency(suggested)}
          </button>
        )}
      </div>
      <p id="margin-pricing-help" className="text-xs text-muted-foreground">
        {metrics ? <>Margin <strong>{formatPercent(metrics.margin)}</strong> · markup {formatPercent(metrics.markup)} · profit {formatCurrency(metrics.grossProfit)} per unit</> : 'Enter a price to see the margin.'}
        {' '}(based on the {costLabel}, {formatCurrency(unitCost)})
      </p>
      {rule
        ? <p className="text-xs text-muted-foreground">Target {formatPercent(rule.targetMargin)} from the {rule.source} rule{suggested !== null ? `: ${formatCurrency(suggested)} rounded up` : ''}.</p>
        : <p className="text-xs text-muted-foreground">No pricing rule applies. Set target margins in Settings → Pricing.</p>}
      {metrics && rule?.minMargin != null && metrics.margin < rule.minMargin && priceValue >= unitCost && (
        <p className="flex items-center gap-1 text-xs text-warning"><AlertTriangle size={14} />Margin is below the {formatPercent(rule.minMargin)} minimum</p>
      )}
    </div>
  );
};
