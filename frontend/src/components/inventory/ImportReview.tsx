import { Link } from 'react-router-dom';
import { CostReview, ImportPreview } from '@/hooks/useInventoryImport';
import { cn, formatCurrency } from '@/lib/utils';
import { formatPercent } from '@/lib/pricing';

const display = (value: unknown) => value == null ? 'New' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
const fieldLabels: Record<string, string> = { name: 'Name', barcode: 'Barcode', price: 'Retail price', cost: 'Unit cost', stockQuantity: 'Stock', lowStockAlert: 'Low-stock alert', categoryId: 'Category', isActive: 'Active', trackInventory: 'Track stock', isTaxable: 'Taxable' };
const describe = (cost: CostReview) => [
  `${formatCurrency(cost.previousUnitCost)} → ${formatCurrency(cost.unitCost)}` + (cost.percentChange === null ? '' : ` (${cost.percentChange > 0 ? '+' : ''}${cost.percentChange}%)`),
  `margin ${formatPercent(cost.margin)} at ${formatCurrency(cost.price)}`,
  ...(cost.targetMargin === null ? [] : [`target ${formatPercent(cost.targetMargin)}`]),
  ...(cost.suggestedPrice === null ? [] : [`suggested ${formatCurrency(cost.suggestedPrice)}`]),
].join(', ');

/** Receipts: what each changed cost does to the margin, with rises at or above the store's alert highlighted. */
function CostChanges({ preview }: { preview: ImportPreview }) {
  const rows = preview.rows.filter(row => row.costReview).sort((a, b) => Number(b.costReview!.flagged) - Number(a.costReview!.flagged) || a.number - b.number);
  if (!rows.length) return null;
  const flagged = rows.filter(row => row.costReview!.flagged).length;
  return <section aria-labelledby="import-cost-changes" className="space-y-2 rounded-lg border p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 id="import-cost-changes" className="text-sm font-semibold">Cost changes{flagged ? ` (${flagged} up ${preview.costAlertPercent}% or more)` : ''}</h3>
      <Link to="/inventory/purchasing/price-review" className="text-sm text-primary hover:underline">Open Price Review</Link>
    </div>
    <ul className="space-y-1.5 text-sm">{rows.map(row => <li key={row.number} className={cn(row.costReview!.flagged && 'text-warning')}>
      <span className="font-medium">{row.costReview!.name}</span>: {describe(row.costReview!)}
    </li>)}</ul>
    <p className="text-xs text-muted-foreground">Prices do not change here. Saving the delivery updates costs; review prices afterwards in Price Review.</p>
  </section>;
}

export function ImportReview({ preview }: { preview: ImportPreview }) {
  return <div className="space-y-3">
    <p>{preview.total} rows: {preview.created} new products, {preview.updated} existing products.</p>
    <CostChanges preview={preview} />
    <p className="text-sm text-muted-foreground">Review every change before applying. Blank optional CSV fields keep existing values. If a product changes after this preview, refresh the review before applying.</p>
    {preview.errors.length > 0 && <div role="alert" className="max-h-40 overflow-y-auto rounded border border-destructive p-3 text-sm">
      {preview.errors.map((error, i) => <p key={i}>{error}</p>)}
    </div>}
    <div className="max-h-80 overflow-auto rounded border">
      <table className="w-full text-sm"><thead className="sticky top-0 bg-background"><tr><th className="p-2 text-left">Row / SKU</th><th className="p-2 text-left">Changes</th><th className="p-2 text-right">Stock</th></tr></thead>
        <tbody>{preview.rows.map(row => <tr key={row.number} className="border-t">
          <td className="p-2 align-top">{row.number}: {row.data.sku}<p className="text-muted-foreground">{row.data.name}</p></td>
          <td className="p-2">{row.changes.length ? row.changes.map(change => <p key={change.field}>{fieldLabels[change.field] || change.field}: {display(change.before)} → {display(change.after)}</p>) : 'No field changes'}</td>
          <td className="p-2 text-right align-top tabular-nums whitespace-nowrap">{row.previousStock} → {row.nextStock}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
