import { AppError } from '../utils/errorHandler';

/**
 * Purchase order lines are stored in base units (cans) at a per-unit cost.
 * When ordered in supplier cases, the case size and case price are kept too,
 * and the line total is the case price times the number of cases, so a case
 * of 3 for $10.00 totals $10.00, not 3 x $3.3333.
 */
export interface OrderLineInput {
  quantity: number;
  cost: number;
  packSize?: number;
  packQuantity?: number | null;
  packCost?: number | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10000) / 10000;

export function orderLine(item: OrderLineInput) {
  const packSize = item.packSize ?? 1;
  if (packSize <= 1) return { quantity: item.quantity, cost: item.cost, total: round2(item.cost * item.quantity), packSize: 1, packQuantity: null, packCost: null };
  const packQuantity = item.packQuantity ?? (item.quantity % packSize === 0 ? item.quantity / packSize : null);
  if (!packQuantity) throw new AppError(`Order cases of ${packSize} in whole cases`, 400);
  if (item.quantity !== packQuantity * packSize)
    throw new AppError(`${packQuantity} case${packQuantity === 1 ? '' : 's'} of ${packSize} is ${packQuantity * packSize} units, not ${item.quantity}`, 400);
  const packCost = item.packCost ?? round4(item.cost * packSize);
  return { quantity: item.quantity, cost: round4(packCost / packSize), total: round2(packCost * packQuantity), packSize, packQuantity, packCost };
}

/** Round a suggested quantity up to whole supplier cases, honoring the supplier minimum (in units). */
export function roundToCases(units: number, packSize = 1, minOrder?: number | null) {
  const wanted = Math.max(units, minOrder || 0, 1);
  return packSize > 1 ? Math.ceil(wanted / packSize) * packSize : wanted;
}
