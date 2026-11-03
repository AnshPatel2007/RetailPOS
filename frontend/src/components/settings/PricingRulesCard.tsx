import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Tags, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { categoryService, pricingService, PriceRounding, PriceRule } from '@/services/api';
import { formatPercent, priceForMargin, ROUNDING_LABELS } from '@/lib/pricing';
import { formatCurrency } from '@/lib/utils';

const toFraction = (value: string) => value.trim() === '' ? null : Number(value) / 100;
const toPercent = (value: number | null | undefined) => value == null ? '' : String(Math.round(value * 1000) / 10);
const SCOPE_LABEL: Record<PriceRule['scope'], string> = { STORE: 'Store', CATEGORY: 'Category', BRAND: 'Brand', PRODUCT: 'Product', SELLING_UNIT: 'Pack' };

/**
 * Target margins used to suggest prices: a store default, overridden by
 * category or brand. Suggestions round up to the chosen price ending and are
 * applied only from the product form or the price review.
 */
export const PricingRulesCard: React.FC<{ editable: boolean }> = ({ editable }) => {
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [store, setStore] = useState({ target: '', minimum: '', rounding: 'CENT' as PriceRounding });
  const [draft, setDraft] = useState({ scope: 'CATEGORY' as 'CATEGORY' | 'BRAND', scopeId: '', target: '', minimum: '', rounding: 'CENT' as PriceRounding });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await pricingService.rules();
      const data: PriceRule[] = res.data.data;
      setRules(data);
      const storeRule = data.find(rule => rule.scope === 'STORE');
      setStore({ target: toPercent(storeRule?.targetMargin), minimum: toPercent(storeRule?.minMargin), rounding: storeRule?.rounding || 'CENT' });
    } catch (err: any) { toast.error(err.response?.data?.error || 'Could not load pricing rules'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    categoryService.getAll({ limit: 500 }).then(res => setCategories((res.data.data || []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })))).catch(() => setCategories([]));
  }, []);

  const save = async (rule: { scope: PriceRule['scope']; scopeId?: string; target: string; minimum: string; rounding: PriceRounding }) => {
    const targetMargin = toFraction(rule.target), minMargin = toFraction(rule.minimum);
    if (targetMargin === null || !(targetMargin >= 0 && targetMargin < 1)) { toast.error('Enter a target margin from 0 to 99.9%'); return false; }
    setBusy(true);
    try {
      await pricingService.saveRule({ scope: rule.scope, scopeId: rule.scopeId, targetMargin, minMargin, rounding: rule.rounding });
      toast.success('Pricing rule saved'); await load(); return true;
    } catch (err: any) { toast.error(err.response?.data?.error || 'Could not save the rule'); return false; }
    finally { setBusy(false); }
  };
  const remove = async (rule: PriceRule) => {
    setBusy(true);
    try { await pricingService.deleteRule(rule.id); toast.success('Rule removed'); await load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Could not remove the rule'); }
    finally { setBusy(false); }
  };

  const example = priceForMargin(1.5, toFraction(store.target) ?? NaN, store.rounding);
  const overrides = rules.filter(rule => rule.scope !== 'STORE');
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center"><Tags className="h-5 w-5 mr-2" />Pricing</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <fieldset disabled={!editable || busy} className="space-y-3">
          <legend className="text-sm font-medium">Store default</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input type="number" label="Target margin (%)" value={store.target} min="0" max="99.9" step="0.1" onChange={e => setStore({ ...store, target: e.target.value })} />
            <Input type="number" label="Minimum margin (%)" description="Optional warning level" value={store.minimum} min="0" max="99.9" step="0.1" onChange={e => setStore({ ...store, minimum: e.target.value })} />
            <Select label="Round suggested prices up to" value={store.rounding} onChange={e => setStore({ ...store, rounding: e.target.value as PriceRounding })}>
              {Object.entries(ROUNDING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Margin is profit as a share of the price. {example !== null ? `Example: an item costing $1.50 at ${store.target}% is suggested at ${formatCurrency(example)}.` : 'Example: $1.50 at 30% is $2.1428, suggested at $2.15.'}
          </p>
          <Button type="button" onClick={() => save({ scope: 'STORE', target: store.target, minimum: store.minimum, rounding: store.rounding })}>Save store default</Button>
        </fieldset>

        <fieldset disabled={!editable || busy} className="space-y-3">
          <legend className="text-sm font-medium">Category and brand targets</legend>
          {overrides.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="p-2 text-left">Applies to</th><th className="p-2 text-right">Target</th><th className="p-2 text-right">Minimum</th><th className="p-2 text-left">Rounding</th><th className="p-2" /></tr></thead>
              <tbody>{overrides.map(rule => (
                <tr key={rule.id} className="border-t border-border">
                  <td className="p-2">{SCOPE_LABEL[rule.scope]}: {rule.label}</td><td className="p-2 text-right">{formatPercent(rule.targetMargin)}</td>
                  <td className="p-2 text-right">{formatPercent(rule.minMargin)}</td><td className="p-2">{ROUNDING_LABELS[rule.rounding]}</td>
                  <td className="p-2 text-right"><Button type="button" variant="outline" aria-label={`Remove rule for ${rule.label}`} onClick={() => remove(rule)}><Trash2 size={16} /></Button></td>
                </tr>))}</tbody>
            </table>
          )}
          <div className="grid gap-3 sm:grid-cols-5">
            <Select label="Applies to" value={draft.scope} onChange={e => setDraft({ ...draft, scope: e.target.value as 'CATEGORY' | 'BRAND', scopeId: '' })}>
              <option value="CATEGORY">Category</option><option value="BRAND">Brand</option>
            </Select>
            {draft.scope === 'CATEGORY'
              ? <Select label="Category" value={draft.scopeId} onChange={e => setDraft({ ...draft, scopeId: e.target.value })}>
                  <option value="">Choose…</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              : <Input label="Brand" value={draft.scopeId} onChange={e => setDraft({ ...draft, scopeId: e.target.value })} placeholder="e.g. Gatorade" maxLength={80} />}
            <Input type="number" label="Target (%)" value={draft.target} min="0" max="99.9" step="0.1" onChange={e => setDraft({ ...draft, target: e.target.value })} />
            <Input type="number" label="Minimum (%)" description="Optional" value={draft.minimum} min="0" max="99.9" step="0.1" onChange={e => setDraft({ ...draft, minimum: e.target.value })} />
            <Select label="Rounding" value={draft.rounding} onChange={e => setDraft({ ...draft, rounding: e.target.value as PriceRounding })}>
              {Object.entries(ROUNDING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>
          <Button type="button" variant="outline" disabled={!draft.scopeId.trim()} onClick={async () => {
            if (await save({ scope: draft.scope, scopeId: draft.scopeId.trim(), target: draft.target, minimum: draft.minimum, rounding: draft.rounding }))
              setDraft({ ...draft, scopeId: '', target: '', minimum: '' });
          }}>Add target</Button>
        </fieldset>
        <p className="text-xs text-muted-foreground">Prices never change on their own. Review items under target in <Link className="text-primary hover:underline" to="/inventory/purchasing/price-review">Price Review</Link>.</p>
      </CardContent>
    </Card>
  );
};
