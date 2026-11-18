import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errorHandler';
import { cents, dollars } from './drawer.service';
import { decimal, portion } from './inventoryCost.service';

// Largest remainder allocation, in integer cents or points. Stable line order
// breaks ties; the allocations always sum to the original booked amount.
export function allocateUnits(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || weights.some(w => !Number.isSafeInteger(w) || w < 0)) throw new AppError('Invalid monetary allocation', 400);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) {
    if (total) throw new AppError('Cannot allocate an amount to an empty sale', 400);
    return weights.map(() => 0);
  }
  const denominator = BigInt(sum);
  const shares = weights.map((weight, index) => {
    const numerator = BigInt(total) * BigInt(weight);
    return { index, amount: Number(numerator / denominator), remainder: numerator % denominator };
  });
  let remaining = total - shares.reduce((n, row) => n + row.amount, 0);
  for (const row of [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (!remaining--) break;
    row.amount++;
  }
  return shares.map(row => row.amount);
}

export const cumulativeShare = (total: number, numerator: number, denominator: number) => denominator ? Number(BigInt(total) * BigInt(numerator) / BigInt(denominator)) : 0;

export function allocateSale<T extends { total: number }>(lines: T[], loyaltyDiscount: number, pointsRedeemed: number, surcharge: number, pointsEarned: number) {
  const before = lines.map(line => cents(line.total));
  const discounts = allocateUnits(cents(loyaltyDiscount), before);
  const redeemed = allocateUnits(pointsRedeemed, discounts);
  const after = before.map((value, i) => value - discounts[i]);
  const surcharges = allocateUnits(cents(surcharge), after);
  const totals = after.map((value, i) => value + surcharges[i]);
  const earned = allocateUnits(pointsEarned, totals);
  return lines.map((line, i) => ({ ...line, total: dollars(totals[i]), loyaltyDiscount: dollars(discounts[i]), pointsRedeemed: redeemed[i], surcharge: dollars(surcharges[i]), pointsEarned: earned[i] }));
}

interface RecordedLine {
  id: string; productId: string; productName: string; quantity: number; total: number | Prisma.Decimal; tax: number | Prisma.Decimal;
  pointsEarned: number | null; pointsRedeemed: number | null; unitCost: unknown;
  costAmount?: Prisma.Decimal | number | null;
  inventoryEntryId?: string | null;
}
interface RecordedReturn {
  saleItemId: string; quantity: number; amount: number | Prisma.Decimal; pointsRestored: number | null; pointsReversed: number | null; taxAmount: unknown;
}

// Amount-only adjustments allocate money without returning quantities. A final
// balance refund returns all remaining quantities; restock is a separate choice.
export function allocateReturn(lines: RecordedLine[], previous: RecordedReturn[], selection: { saleItemId: string; quantity: number }[] | undefined, amount: number | undefined, restock: boolean) {
  const facts = lines.map(line => {
    const returns = previous.filter(row => row.saleItemId === line.id);
    return { line, returned: returns.reduce((n, row) => n + row.quantity, 0),
      paidBack: returns.reduce((n, row) => n + cents(row.amount), 0),
      restored: returns.reduce((n, row) => n + (row.pointsRestored || 0), 0),
      reversed: returns.reduce((n, row) => n + (row.pointsReversed || 0), 0),
      taxBack: returns.reduce((n, row) => n + cents(Number(row.taxAmount || 0)), 0),
    };
  });
  const itemMode = !!selection?.length;
  const amounts = itemMode ? [] : allocateUnits(cents(amount!), facts.map(f => cents(f.line.total) - f.paidBack));
  const fullBalance = !itemMode && cents(amount!) === facts.reduce((n, f) => n + cents(f.line.total) - f.paidBack, 0);
  const seen = new Set<string>();
  for (const item of selection || []) {
    const f = facts.find(f => f.line.id === item.saleItemId);
    if (!f || seen.has(item.saleItemId) || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > f.line.quantity - f.returned) throw new AppError('Invalid or excessive return quantity', 400);
    seen.add(item.saleItemId);
  }
  return facts.flatMap((f, index) => {
    const { line } = f;
    const quantity = itemMode ? selection!.find(item => item.saleItemId === line.id)?.quantity || 0 : 0;
    if (itemMode && !quantity) return [];
    const cash = itemMode ? Math.min(cents(line.total) - f.paidBack, cumulativeShare(cents(line.total), f.returned + quantity, line.quantity) - cumulativeShare(cents(line.total), f.returned, line.quantity)) : amounts[index];
    // Returning the last unit also consumes any rounding remainder from earlier
    // value adjustments. Nothing exceeds the original line's money or points.
    const finalLine = fullBalance || (itemMode && f.returned + quantity === line.quantity);
    const refunded = finalLine ? cents(line.total) - f.paidBack : cash;
    const metric = (total: number, used: number) => {
      const share = finalLine ? total - used : itemMode
        ? cumulativeShare(total, f.returned + quantity, line.quantity) - cumulativeShare(total, f.returned, line.quantity)
        : cumulativeShare(total, f.paidBack + refunded, cents(line.total)) - used;
      return Math.max(0, Math.min(total - used, share));
    };
    const pointsRestored = metric(line.pointsRedeemed || 0, f.restored);
    const pointsReversed = metric(line.pointsEarned || 0, f.reversed);
    const taxAmount = dollars(metric(cents(line.tax), f.taxBack));
    if (!quantity && !refunded && !pointsRestored && !pointsReversed && !taxAmount) return [];
    return [{ saleItemId: line.id, productId: line.productId, productName: line.productName, quantity, amount: dollars(refunded), pointsRestored, pointsReversed, taxAmount,
      costReturned: restock && quantity ? portion(line.costAmount != null ? decimal(line.costAmount)
        : line.inventoryEntryId || line.unitCost == null ? null : decimal(String(line.unitCost)).mul(line.quantity), line.quantity, f.returned, quantity)?.toNumber() ?? null : 0,
    }];
  });
}
