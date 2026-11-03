import { Prisma } from '@prisma/client';
import { allocateUnits } from './saleAllocation.service';
import { cashAmount, cents, dollars } from './drawer.service';
import { AppError } from '../utils/errorHandler';

export type SnapTaxLine = { id: string; discountedPrincipal: number; snapEligible: boolean; taxRatePercent: number;
  ageRestricted?: boolean; giftCard?: boolean; manufacturerCoupon?: number };

/** Staged arithmetic only. Neither quote nor checkout calls this function.
 * Provider onboarding, jurisdiction review, stored source allocations and an
 * electronic original-SNAP-card refund workflow remain activation requirements.
 * Coupon reimbursements need a separate jurisdiction rule and are rejected.
 */
export function calculateStagedSnapTaxPlan(input: SnapTaxLine[], snapAmount: number) {
  cashAmount(snapAmount, 'SNAP amount');
  if (!input.length || new Set(input.map(line => line.id)).size !== input.length) throw new AppError('Use unique SNAP tax lines.', 400);
  const lines = [...input].sort((a, b) => a.id.localeCompare(b.id));
  for (const line of lines) {
    cashAmount(line.discountedPrincipal, 'Discounted item principal');
    if (!Number.isFinite(line.taxRatePercent) || line.taxRatePercent < 0 || line.taxRatePercent > 100) throw new AppError('A reviewed tax rate is required for every line.', 400);
    if (line.manufacturerCoupon !== undefined) cashAmount(line.manufacturerCoupon, 'Manufacturer coupon');
    if (line.manufacturerCoupon) throw new AppError('Manufacturer-coupon SNAP tax treatment requires a reviewed jurisdiction rule.', 409);
    if (line.snapEligible && (line.ageRestricted || line.giftCard)) throw new AppError('Age-restricted items and gift-card funding cannot be marked SNAP eligible.', 400);
  }
  const weights = lines.map(line => line.snapEligible ? cents(line.discountedPrincipal) : 0);
  const eligible = weights.reduce((sum, value) => sum + value, 0);
  if (cents(snapAmount) > eligible) throw new AppError('SNAP cannot exceed eligible discounted item principal or pay sales tax.', 400);
  const allocations = allocateUnits(cents(snapAmount), weights);
  const result = lines.map((line, index) => {
    const taxablePrincipal = dollars(cents(line.discountedPrincipal) - allocations[index]);
    const tax = new Prisma.Decimal(taxablePrincipal).mul(line.taxRatePercent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
    return { id: line.id, discountedPrincipal: line.discountedPrincipal, snapPrincipal: dollars(allocations[index]), taxablePrincipal, tax,
      taxRatePercent: line.taxRatePercent, taxTreatment: allocations[index] ? allocations[index] === cents(line.discountedPrincipal) ? 'STAGED_SNAP_EXEMPT' : 'STAGED_SNAP_PARTIAL_EXEMPT' : 'STANDARD' };
  });
  const tax = dollars(result.reduce((sum, line) => sum + cents(line.tax), 0));
  const total = dollars(result.reduce((sum, line) => sum + cents(line.discountedPrincipal) + cents(line.tax), 0));
  return { status: 'STAGED_ONLY' as const, lines: result, snapAmount, tax, total, otherTenderAmount: dollars(cents(total) - cents(snapAmount)) };
}
