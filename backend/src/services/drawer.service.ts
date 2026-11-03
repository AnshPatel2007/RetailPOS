import { moneyCents } from '../utils/money';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';

// Book USD at the boundary, then add integer cents. Decimal storage prevents
// new drawer entries from accumulating binary floating-point differences.
export const cents = moneyCents;
export const dollars = (amount: number) => amount / 100;
export function cashAmount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 999999999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
    throw new AppError(`${label} must be a nonnegative amount with at most two decimal places`, 400);
  }
  return dollars(cents(value));
}

export async function lockDrawer(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM shifts WHERE id = ${id} FOR UPDATE`;
  return tx.shift.findUniqueOrThrow({ where: { id } });
}

// Every operational path takes the drawer lock before sale/product/account locks.
// Closing the drawer therefore includes a committed operation or rejects it.
export async function lockCurrentDrawer(tx: Prisma.TransactionClient, req: AuthRequest, required = true) {
  const shift = await tx.shift.findFirst({
    where: { userId: req.user!.id, locationId: req.user!.locationId, isClosed: false },
    orderBy: { clockInAt: 'desc' },
  });
  if (!shift) {
    if (required) throw new AppError('No open shift. Clock in before paying cash from this drawer.', 400);
    return null;
  }
  const current = await lockDrawer(tx, shift.id);
  if (current.isClosed) throw new AppError('This shift has closed. Clock in again before continuing.', 409);
  return current;
}

type PaidSale = { paymentMethod: string; total: number | Prisma.Decimal; changeDue: number | Prisma.Decimal; payments: { paymentMethod: string; amount: number | Prisma.Decimal }[] };
export function saleTenderAmounts(sale: PaidSale) {
  const totals: Record<string, number> = {};
  if (!sale.payments.length) totals[sale.paymentMethod] = cents(sale.total);
  else {
    for (const p of sale.payments) totals[p.paymentMethod] = (totals[p.paymentMethod] || 0) + cents(p.amount);
    if ('CASH' in totals) totals.CASH -= cents(Math.max(0, Number(sale.changeDue)));
  }
  return totals;
}

export async function postDrawerEntry(tx: Prisma.TransactionClient, data: Omit<Prisma.DrawerEntryUncheckedCreateInput, 'amount'> & { amount: number }) {
  if (cents(data.amount) === 0) return;
  return tx.drawerEntry.create({ data: { ...data, amount: new Prisma.Decimal(dollars(cents(data.amount)).toFixed(2)) } });
}

export const drawerInclude = {
  sales: {
    where: { status: { in: ['COMPLETED', 'REFUNDED', 'VOIDED'] as ('COMPLETED' | 'REFUNDED' | 'VOIDED')[] } },
    select: { id: true, saleNumber: true, total: true, tax: true, discount: true, paymentMethod: true, changeDue: true, createdAt: true, payments: { select: { paymentMethod: true, amount: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
  cashMovements: { orderBy: { createdAt: 'desc' as const } },
  drawerEntries: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ShiftInclude;

type Drawer = Prisma.ShiftGetPayload<{ include: typeof drawerInclude }>;
export function summarizeDrawer(shift: Drawer) {
  const tenderBreakdown: Record<string, { count: number; total: number }> = {};
  for (const sale of shift.sales) {
    for (const [method, amount] of Object.entries(saleTenderAmounts(sale))) {
      const prior = tenderBreakdown[method] || { count: 0, total: 0 };
      tenderBreakdown[method] = { count: prior.count + 1, total: prior.total + amount };
    }
  }
  for (const tender of Object.values(tenderBreakdown)) tender.total = dollars(tender.total);
  let sales = 0, refunds = 0, voids = 0, movements = 0, giftFunding = 0, housePayments = 0;
  for (const entry of shift.drawerEntries) {
    const amount = cents(Number(entry.amount));
    if (entry.type === 'SALE') sales += amount;
    else if (entry.type === 'REFUND') refunds -= amount;
    else if (entry.type === 'VOID') voids -= amount;
    else if (entry.type === 'GIFT_FUNDING') giftFunding += amount;
    else if (entry.type === 'HOUSE_PAYMENT') housePayments += amount;
    else movements += amount;
  }
  const calculatedExpected = dollars(cents(Number(shift.startingCash)) + sales - refunds - voids + movements + giftFunding + housePayments);
  return {
    totalSales: dollars(shift.sales.reduce((sum, sale) => sum + cents(Number(sale.total)), 0)),
    totalTransactions: shift.sales.length,
    totalTax: dollars(shift.sales.reduce((sum, sale) => sum + cents(Number(sale.tax)), 0)),
    totalDiscount: dollars(shift.sales.reduce((sum, sale) => sum + cents(Number(sale.discount)), 0)),
    cashSales: dollars(sales), cashRefunds: dollars(refunds), cashVoids: dollars(voids), cashMovementNet: dollars(movements),
    cashGiftFunding: dollars(giftFunding), cashHousePayments: dollars(housePayments),
    startingCash: shift.startingCash,
    expectedCash: shift.isClosed ? shift.expectedCash : calculatedExpected,
    calculatedExpected,
    endingCash: shift.endingCash, cashDifference: shift.cashDifference,
    tenderBreakdown, paymentBreakdown: tenderBreakdown,
    drawerHistoryComplete: shift.drawerHistoryComplete,
    reconciliationWarning: shift.drawerHistoryComplete ? null : 'Older refunds and voids did not record their paying drawer. This shift requires manual reconciliation; its original closed count is preserved.',
  };
}
