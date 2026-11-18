import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { assertOwnsRecord } from '../utils/locationFilter.util';
import { cashAmount, cents, dollars, lockCurrentDrawer } from './drawer.service';
import { lockInventory } from './inventory.service';
import { lockSale, refundSaleInTransaction } from './saleReversal.service';
import { recordOperation } from './operationReceipt.service';
import { getRefundTenderOptions } from './refundTenders.service';

const line = z.object({ id: z.string().uuid(), expectedAmount: z.number().finite().nonnegative(),
  refundMethod: z.enum(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT']).optional(), reference: z.string().trim().max(150).optional(),
  refundTenders: z.array(z.object({ sourcePaymentId: z.string().min(1).max(100), method: z.enum(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT']),
    amount: z.number().finite().positive().multipleOf(0.01), reference: z.string().trim().max(150).optional() }).strict()).max(20).optional() }).strict();
const schema = z.object({ idempotencyKey: z.string().uuid(), reason: z.string().trim().min(1).max(500), sales: z.array(line).min(1).max(50) }).strict();
const previewSchema = z.object({ saleIds: z.array(z.string().uuid()).min(1).max(50) }).strict();

export async function previewBulkRefund(req: AuthRequest) {
  const { saleIds } = previewSchema.parse(req.body);
  if (new Set(saleIds).size !== saleIds.length) throw new AppError('Select unique sales', 400);
  return prisma.$transaction(async tx => {
    const sales = await tx.sale.findMany({ where: { id: { in: saleIds } }, include: { refunds: true, payments: true } });
    if (sales.length !== saleIds.length) throw new AppError('Sale not found', 404);
    return sales.map(sale => {
      assertOwnsRecord(req, sale.locationId);
      const remaining = dollars(cents(Number(sale.total)) - sale.refunds.reduce((sum, refund) => sum + cents(Number(refund.amount)), 0));
      let refundTenderOptions: ReturnType<typeof getRefundTenderOptions> = [], refundTenderError: string | null = null;
      try { refundTenderOptions = getRefundTenderOptions(sale); }
      catch (error) { refundTenderError = (error as Error).message; }
      const method = refundTenderOptions.length === 1 ? refundTenderOptions[0].method : 'SPLIT';
      return { id: sale.id, saleNumber: sale.saleNumber, originalAmount: Number(sale.total), expectedAmount: remaining,
        refundMethod: method, reference: method === 'GIFT_CARD' ? sale.payments.find(payment => payment.paymentMethod === 'GIFT_CARD')?.reference || '' : '',
        refundTenderOptions, refundTenderError, hasCustomer: !!sale.customerId,
        eligible: sale.sourceType !== 'DAILY_SUMMARY' && !refundTenderError && sale.status === 'COMPLETED' && sale.paymentMethod !== 'EBT' && !sale.payments.some(payment => payment.paymentMethod === 'EBT'),
        status: sale.status, pointsOnly: Number(sale.total) === 0 && !!sale.pricingVersion };
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function bulkRefund(req: AuthRequest) {
  const input = schema.parse(req.body);
  if (new Set(input.sales.map(sale => sale.id)).size !== input.sales.length) throw new AppError('Select unique sales', 400);
  input.sales.forEach(sale => {
    cashAmount(sale.expectedAmount, 'Refund amount');
    if (sale.refundMethod === 'CARD' && !sale.reference) throw new AppError('Record each external card refund reference before saving the batch', 400);
  });
  input.sales.sort((a, b) => a.id.localeCompare(b.id));
  return recordOperation(req, 'BULK_REFUND', 'sales', input.idempotencyKey, input, async tx => {
    await lockCurrentDrawer(tx, req, false);
    for (const sale of input.sales) await lockSale(tx, sale.id);
    const originals = await tx.sale.findMany({ where: { id: { in: input.sales.map(sale => sale.id) } }, include: { items: true, refunds: { include: { items: true } } } });
    if (originals.length !== input.sales.length) throw new AppError('Sale not found', 404);
    originals.forEach(sale => assertOwnsRecord(req, sale.locationId));
    await lockInventory(tx, originals.flatMap(sale => sale.items.map(item => item.productId)));
    const refunds = [];
    for (const selection of input.sales) {
      const original = originals.find(sale => sale.id === selection.id)!;
      const remaining = dollars(cents(Number(original.total)) - original.refunds.reduce((sum, refund) => sum + cents(Number(refund.amount)), 0));
      if (cents(remaining) !== cents(selection.expectedAmount)) throw new AppError('Refund balance changed. Review the batch again.', 409);
      // This workflow explicitly returns all remaining merchandise as well as money.
      const items = original.items.map(item => ({ saleItemId: item.id,
        quantity: item.quantity - original.refunds.flatMap(refund => refund.items).filter(line => line.saleItemId === item.id).reduce((sum, line) => sum + line.quantity, 0),
      })).filter(item => item.quantity > 0);
      const request = { ...req, params: { id: selection.id }, user: req.user, body: { amount: selection.expectedAmount,
        expectedAmount: selection.expectedAmount, reason: input.reason, ...(selection.refundTenders ? { refundTenders: selection.refundTenders } : { refundMethod: selection.refundMethod, reference: selection.reference || undefined }),
        idempotencyKey: randomUUID(), ...(items ? { items } : {}), restock: true } } as unknown as AuthRequest;
      const { refund, sale } = await refundSaleInTransaction(request, tx);
      refunds.push({ saleId: sale.id, saleNumber: original.saleNumber, refundId: refund.id, amount: Number(refund.amount), method: refund.method,
        reference: refund.reference, tenders: refund.tenders, pointsRestored: refund.pointsRestored, pointsReversed: refund.pointsReversed });
    }
    return { refundedCount: refunds.length, refunds, reason: input.reason };
  });
}
