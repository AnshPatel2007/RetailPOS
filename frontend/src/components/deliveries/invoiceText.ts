import { formatCurrency } from '@/lib/utils';
import type { InvoiceCounts, InvoiceLine, InvoiceTier } from '@/types/deliveryInvoices';

/** Plain words for how a delivery invoice's lines stand (shared by the review, the list and the capture pop-up). */
const plural = (count: number, one: string, many = one + 's') => `${count} ${count === 1 ? one : many}`;

export const tierLabel: Record<InvoiceTier, string> = { SURE: 'Sure', CHECK: 'To check', NEW: 'New', CREDIT: 'Credit' };

/** "24 lines · 312 units · 20 sure · 3 to check · 1 new" */
export function invoiceCountsLine(counts: InvoiceCounts) {
  return [plural(counts.lines, 'line'), plural(counts.units, 'unit'), counts.sure && `${counts.sure} sure`,
    counts.check && `${counts.check} to check`, counts.new && `${counts.new} new`].filter(Boolean).join(' · ');
}

/** "2 cases × 24 = 48 units", "6 units", "1 carton of 10 = 10 units" */
export function unitsLine(line: Pick<InvoiceLine, 'receivedQuantity' | 'unitsPerCase' | 'units' | 'product' | 'unit'>) {
  const quantity = Number.isInteger(line.receivedQuantity) ? String(line.receivedQuantity) : String(Math.round(line.receivedQuantity * 100) / 100);
  if (line.unitsPerCase <= 1) return plural(line.units, 'unit');
  const pack = line.product?.sellingUnitId ? line.product.name : null;
  const counted = pack ? `${quantity} × ${pack}` : `${quantity} ${Number(quantity) === 1 ? 'case' : 'cases'} × ${line.unitsPerCase}`;
  return `${counted} = ${plural(line.units, 'unit')}`;
}

/** "$12.00 a case ($0.50 each)", "$1.00 each", "No cost on the invoice" */
export function costLine(line: Pick<InvoiceLine, 'caseCost' | 'unitCost' | 'unitsPerCase'>) {
  if (line.caseCost === null || line.unitCost === null) return 'No cost on the invoice';
  if (line.unitsPerCase <= 1) return `${formatCurrency(line.unitCost)} each`;
  return `${formatCurrency(line.caseCost)} a case (${formatCurrency(line.unitCost)} each)`;
}

/** "Up 6% from last time" when the cost rose at least the store's alert percent; "Down 4%"; nothing for small moves. */
export function costChangeText(change: number | null, alertPercent: number) {
  if (change === null || Math.abs(change) < 0.5) return null;
  const rounded = Math.abs(change) >= 10 ? Math.round(Math.abs(change)) : Math.round(Math.abs(change) * 10) / 10;
  return { rising: change > 0, flagged: change >= alertPercent, text: `${change > 0 ? 'Up' : 'Down'} ${rounded}% from last time` };
}

/** Lines that need a person first, then the sure and decided ones, then skipped and credits; invoice order within each. */
export function reviewOrder(lines: InvoiceLine[]) {
  const rank = (line: InvoiceLine) => line.skip ? 2 : !line.confirmed || line.checkUnits || (line.caseCost === null && line.units > 0) || line.units === 0 ? 0 : 1;
  return [...lines].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
}

/** What still blocks the OK on one line, in plain words (empty when nothing). */
export function lineProblem(line: InvoiceLine): string | null {
  if (line.skip) return null;
  if (!line.confirmed) return line.newItem && line.newItem.price === null ? 'Enter a price for the new item.' : line.product ? 'Confirm the item.' : 'Choose the item, add it as new, or skip it.';
  if (line.units <= 0) return 'Enter how many arrived, or skip it.';
  if (line.caseCost === null) return 'Enter what it cost.';
  return null;
}
