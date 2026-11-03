import { allocateReturn, cumulativeShare } from './saleAllocation.service';
import { businessConfig } from '../config/business.config';
import { Prisma, SaleStatus } from '@prisma/client';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { assertOwnsRecord, assertCanReadRecord } from '../utils/locationFilter.util';
import { requireTransactionApproval, requestHash } from './managerApproval.service';
import { lockInventory, moveInventory } from './inventory.service';
import { lockCurrentDrawer, postDrawerEntry, saleTenderAmounts, dollars, cents, cashAmount } from './drawer.service';
import { z } from 'zod';
import { assertReversalTendersAvailable } from './tenderAvailability.service';
import { queueWebhook } from './webhook.service';
import { planRefundTenders, creditRefundTenders } from './refundTenders.service';
import { effectiveEntry, portion, postNonstockCost, decimal } from './inventoryCost.service';

const tierForPoints = (points: number) => points >= businessConfig.customer.loyaltyTiers.GOLD.min ? 'GOLD' : points >= businessConfig.customer.loyaltyTiers.SILVER.min ? 'SILVER' : 'BRONZE';

export const lockSale = async (tx: Prisma.TransactionClient, id: string) => {
  await tx.$queryRaw`SELECT id FROM sales WHERE id = ${id} FOR UPDATE`;
};

export const refundSaleInTransaction = async (req: AuthRequest, tx: Prisma.TransactionClient) => {
  const { id } = req.params;
  const { amount, reason, notes, items, restock = true, idempotencyKey } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const payingShift = await lockCurrentDrawer(tx, req, false);
  await lockSale(tx, id);
  const sale = await tx.sale.findUnique({
    where: { id },
    include: { items: true, refunds: { include: { items: true } }, payments: true },
  });

  if (!sale) {
    throw new AppError('Sale not found', 404);
  }

  assertOwnsRecord(req, sale.locationId);
  if (sale.sourceType === 'DAILY_SUMMARY') throw new AppError('Historical daily summaries cannot be refunded or voided as receipts.', 409);
  const hash = requestHash('POST', id, { ...req.body, userId: req.user.id });
  if (idempotencyKey) {
    const previous = await tx.refund.findUnique({ where: { idempotencyKey } });
    if (previous) {
      if (previous.saleId !== id || previous.refundedBy !== req.user.id || previous.requestHash !== hash) throw new AppError('This refund retry key belongs to a different request', 409);
      return { sale, refund: previous, replayed: true };
    }
  }
  assertReversalTendersAvailable(sale);
  await requireTransactionApproval(req, tx, 'sale.reverse');
  await lockInventory(tx, sale.items.map(item => item.productId));
  for (const item of sale.items) if (item.inventoryEntryId) item.costAmount = (await effectiveEntry(tx, item.inventoryEntryId)).cogsAmount;

  if (sale.status === SaleStatus.VOIDED) {
    throw new AppError('Cannot refund a voided sale', 400);
  }
  // A corrected line's stock now belongs to a different SKU; restocking the
  // original product would undo the correction.
  if (restock !== false && await tx.saleItemCorrection.count({ where: { saleId: sale.id } }))
    throw new AppError('A line on this sale had its product corrected. Refund without restocking, then count the returned item into stock.', 409);

  // Calculate already-refunded amount
  const previouslyRefunded = dollars(sale.refunds.reduce((sum, r) => sum + cents(Number(r.amount)), 0));
  const refundableAmount = dollars(cents(Number(sale.total)) - cents(previouslyRefunded));

  if (sale.status === SaleStatus.REFUNDED || (refundableAmount <= 0 && !sale.pricingVersion)) {
    throw new AppError('Sale has already been fully refunded', 400);
  }

  // Per-sale-item quantities already refunded / restocked by earlier item-level refunds
  const refundedQtyByItem = new Map<string, number>();
  const restockedQtyByItem = new Map<string, number>();
  for (const r of sale.refunds) {
    for (const ri of r.items) {
      refundedQtyByItem.set(ri.saleItemId, (refundedQtyByItem.get(ri.saleItemId) || 0) + ri.quantity);
      if (ri.restocked) {
        restockedQtyByItem.set(ri.saleItemId, (restockedQtyByItem.get(ri.saleItemId) || 0) + ri.quantity);
      }
    }
  }

  // Item-level refunds: compute the amount server-side from the returned lines
  // (each unit refunds its prorated share of the line total, tax included)
  let refundAmount: number;
  let refundLines: { saleItemId: string; productId: string; productName: string; quantity: number; amount: number; pointsRestored?: number; pointsReversed?: number; taxAmount?: number; costReturned?: number | null }[] = [];

  if (items && items.length > 0) {
    const saleItemMap = new Map(sale.items.map((i) => [i.id, i]));
    let computed = 0;
    const seen = new Set<string>();
    for (const line of items as { saleItemId: string; quantity: number }[]) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new AppError('Invalid refund quantity', 400);
      if (seen.has(line.saleItemId)) throw new AppError('Duplicate refund item', 400);
      seen.add(line.saleItemId);
      const saleItem = saleItemMap.get(line.saleItemId);
      if (!saleItem) {
        throw new AppError(`Sale item not found on this sale: ${line.saleItemId}`, 400);
      }
      const refundableQty = saleItem.quantity - (refundedQtyByItem.get(saleItem.id) || 0);
      if (line.quantity > refundableQty) {
        throw new AppError(
          `Cannot refund ${line.quantity} × "${saleItem.productName}": only ${refundableQty} left to refund`,
          400
        );
      }
      const priorQuantity = refundedQtyByItem.get(saleItem.id) || 0;
      const lineAmount = dollars(cumulativeShare(cents(Number(saleItem.total)), priorQuantity + line.quantity, saleItem.quantity) - cumulativeShare(cents(Number(saleItem.total)), priorQuantity, saleItem.quantity));
      computed += lineAmount;
      refundLines.push({
        saleItemId: saleItem.id,
        productId: saleItem.productId,
        productName: saleItem.productName,
        quantity: line.quantity,
        amount: lineAmount,
      });
    }
    refundAmount = Math.round(computed * 100) / 100;
  } else {
    refundAmount = amount;
  }

  if (sale.pricingVersion) {
    if (!items?.length && (!Number.isFinite(amount) || amount <= 0 || cents(amount) > cents(refundableAmount))) throw new AppError('Refund amount exceeds refundable balance or is not positive', 400);
    if (!items?.length) cashAmount(amount, 'Refund amount');
    refundLines = allocateReturn(sale.items, sale.refunds.flatMap(refund => refund.items), items, amount, restock !== false);
    refundAmount = dollars(refundLines.reduce((n, line) => n + cents(line.amount), 0));
  }
  if (!Number.isFinite(refundAmount) || refundAmount < 0 || (refundAmount === 0 && !refundLines.some(line => line.quantity > 0))) throw new AppError('Select returned items or a positive refund amount', 400);
  refundAmount = cashAmount(refundAmount, 'Refund amount');
  if (typeof req.body.expectedAmount === 'number' && cents(req.body.expectedAmount) !== cents(refundAmount)) throw new AppError('Refund amount changed. Reload the sale and review the return before paying.', 409);
  if (cents(refundAmount) > cents(refundableAmount)) {
    throw new AppError(
      `Refund amount exceeds refundable balance. Max refundable: $${refundableAmount.toFixed(2)}`,
      400
    );
  }
  const tenders = planRefundTenders(sale, refundAmount, req.body);
  const cashRefund = dollars(tenders.filter(part => part.method === 'CASH').reduce((sum, part) => sum + cents(part.amount), 0));
  const refundMethod = [...new Set(tenders.map(part => part.method))].length > 1 ? 'SPLIT' : tenders[0]?.method || 'NONE';
  const reference = tenders.length === 1 ? tenders[0].reference : undefined;
  if (cashRefund > 0 && !payingShift) throw new AppError('Clock in before issuing a cash refund. The payout must belong to your current drawer.', 400);

  // Match checkout lock order before crediting a tender or restoring inventory.
  await lockInventory(tx, sale.items.map(item => item.productId));
  if (sale.customerId) await tx.$queryRaw`SELECT id FROM customers WHERE id = ${sale.customerId} FOR UPDATE`;

  // Update sale, credit the refund tender, and restore inventory
  // Create refund record (with item lines when this is an item-level refund)
  const pointsRestored = sale.pricingVersion ? refundLines.reduce((n, line) => n + (line.pointsRestored || 0), 0) : null;
  const pointsReversed = sale.pricingVersion ? refundLines.reduce((n, line) => n + (line.pointsReversed || 0), 0) : null;
  const refund = await tx.refund.create({
    data: {
      saleId: id,
      pointsRestored, pointsReversed,
      taxAmount: sale.pricingVersion ? dollars(refundLines.reduce((n, line) => n + cents(line.taxAmount || 0), 0)) : null,
      amount: refundAmount,
      tenders: tenders as Prisma.InputJsonValue,
      reason,
      notes,
      refundedBy: req.user!.id,
      method: refundMethod || null,
      reference: reference || null,
      idempotencyKey: idempotencyKey || null,
      requestHash: idempotencyKey ? hash : null,
      items: refundLines.length > 0
        ? {
            create: refundLines.map((line) => ({
              saleItemId: line.saleItemId,
              quantity: line.quantity,
              amount: line.amount,
              restocked: restock !== false && line.quantity > 0,
              pointsRestored: line.pointsRestored, pointsReversed: line.pointsReversed, taxAmount: line.taxAmount, costReturned: line.costReturned,
            })),
          }
        : undefined,
    },
  });
  if (cashRefund > 0) {
    await postDrawerEntry(tx, { sourceKey: 'refund:' + refund.id, shiftId: payingShift!.id, locationId: sale.locationId, userId: req.user.id, saleId: id, refundId: refund.id, type: 'REFUND', amount: -cashRefund });
  }

  await creditRefundTenders(req, tx, sale, tenders);

  // Mark fully refunded if total refunds now equal sale total
  const totalRefundedNow = previouslyRefunded + refundAmount;
  const allQuantitiesReturned = sale.items.every(item => (refundedQtyByItem.get(item.id) || 0) + refundLines.filter(line => line.saleItemId === item.id).reduce((n, line) => n + line.quantity, 0) >= item.quantity);
  const isFullyRefunded = cents(totalRefundedNow) >= cents(Number(sale.total)) && (!sale.pricingVersion || allQuantitiesReturned);

  const updated = await tx.sale.update({
    where: { id },
    data: {
      status: isFullyRefunded ? SaleStatus.REFUNDED : SaleStatus.COMPLETED,
      refundedAt: isFullyRefunded ? new Date() : undefined,
    },
    include: {
      items: true,
      refunds: { include: { items: true } },
    },
  });

  if (refundLines.length > 0 && restock !== false) {
    // Item-level refund: restock exactly the returned units
    for (const line of refundLines.filter(line => line.quantity > 0).sort((a, b) => a.productId.localeCompare(b.productId))) {
      const product = await tx.product.findUnique({ where: { id: line.productId } });
      if (product?.trackInventory) {
        await moveInventory(tx, {
          productId: line.productId, locationId: sale.locationId!, userId: req.user.id,
          type: 'RETURN', sourceId: refund.id, sourceKey: 'refund-line:' + refund.id + ':' + line.saleItemId, quantity: line.quantity,
          valueMode: sale.items.find(item => item.id === line.saleItemId)?.inventoryEntryId ? 'REFERENCE' : 'FIXED', valueInput: line.costReturned ?? null,
          referenceEntryId: sale.items.find(item => item.id === line.saleItemId)?.inventoryEntryId,
          referenceQuantity: line.quantity, referenceOffset: refundedQtyByItem.get(line.saleItemId) || 0,
          notes: `Refund for sale ${sale.saleNumber}`,
        });
      } else if (product && sale.items.find(item => item.id === line.saleItemId)?.inventoryEntryId) {
        await postNonstockCost(tx, { productId: line.productId, locationId: sale.locationId!, userId: req.user.id,
          sourceId: refund.id, sourceKey: 'refund-line:' + refund.id + ':' + line.saleItemId, kind: 'RETURN', quantity: line.quantity,
          cost: line.costReturned == null ? null : decimal(line.costReturned), referenceEntryId: sale.items.find(item => item.id === line.saleItemId)?.inventoryEntryId,
          referenceOffset: refundedQtyByItem.get(line.saleItemId) || 0 });
      }
    }
  } else if (refundLines.length === 0 && isFullyRefunded && restock !== false && items?.length) {
    // Money-only refund that completes the full amount: restore whatever
    // earlier item-level refunds haven't already put back
    for (const item of [...sale.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const toRestore = item.quantity - (restockedQtyByItem.get(item.id) || 0);
      if (toRestore <= 0) continue;
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (product?.trackInventory) {
        await moveInventory(tx, {
          productId: item.productId, locationId: sale.locationId!, userId: req.user.id,
          type: 'RETURN', sourceId: refund.id, sourceKey: 'refund-line:' + refund.id + ':' + item.id, quantity: toRestore,
          valueMode: 'FIXED', valueInput: item.unitCost === null ? null : item.unitCost.mul(toRestore),
          notes: `Refund for sale ${sale.saleNumber}`,
        });
      }
    }
  }

  if (restock === false) for (const line of refundLines.filter(line => line.quantity > 0)) {
    const original = sale.items.find(item => item.id === line.saleItemId)!;
    const product = await tx.product.findUnique({ where: { id: line.productId } });
    if (product?.trackInventory) await moveInventory(tx, { productId: line.productId, locationId: sale.locationId!, userId: req.user.id,
      type: 'RETURN_LOSS', sourceId: refund.id, sourceKey: 'return-loss:' + refund.id + ':' + line.saleItemId, quantity: 0,
      valueMode: original.inventoryEntryId ? 'REFERENCE' : 'FIXED', referenceEntryId: original.inventoryEntryId,
      referenceQuantity: line.quantity, referenceOffset: refundedQtyByItem.get(line.saleItemId) || 0,
      valueInput: portion(original.costAmount ?? (original.unitCost?.mul(original.quantity) ?? null), original.quantity, refundedQtyByItem.get(line.saleItemId) || 0, line.quantity),
      notes: 'Unsellable returned goods; original sale cost retained, no second expense. ' + reason });
  }

  // Update customer stats (floored at 0 so refunds can't drive them negative)
  if (sale.customerId) {
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${sale.customerId} FOR UPDATE`;
    const customer = await tx.customer.findUnique({
      where: { id: sale.customerId },
      select: { totalSpent: true, loyaltyPoints: true },
    });
    if (customer) {
      await tx.customer.update({
        where: { id: sale.customerId },
        data: {
          totalSpent: Math.max(0, Math.round((Number(customer.totalSpent) - refundAmount) * 100) / 100),
          // If earned points were already spent, retain the negative balance.
          // Future earnings settle it; clamping would give those spent points twice.
          loyaltyPoints: sale.pricingVersion ? customer.loyaltyPoints + (pointsRestored || 0) - (pointsReversed || 0) : Math.max(0, customer.loyaltyPoints - Math.floor(refundAmount)),
          ...(sale.pricingVersion ? { loyaltyTier: tierForPoints(customer.loyaltyPoints + (pointsRestored || 0) - (pointsReversed || 0)) } : {}),
        },
      });
    }
  }



  await tx.activityLog.create({ data: { userId: req.user!.id, action: 'REFUND', entity: 'SALE', entityId: id, locationId: sale.locationId, details: { refundAmount, refundMethod, tenders } } });
  await queueWebhook(tx, 'sale.refunded', { saleId: sale.id, saleNumber: sale.saleNumber, refundId: refund.id, refundAmount: refund.amount, refundMethod: refund.method || 'NONE', tenders, reason: refund.reason }, refund.id, sale.locationId, refund.createdAt);
  return { sale: updated, refund, replayed: false };
};

export const voidSaleInTransaction = async (req: AuthRequest, tx: Prisma.TransactionClient, batchRequestHash?: string) => {
  const id = req.params.id;
  const input = z.object({ reason: z.string().trim().min(1).max(500).default('Voided sale'), idempotencyKey: z.string().uuid().optional(), expectedAmount: z.number().finite().nonnegative().optional() }).parse(req.body || {});
  const hash = requestHash('VOID', id, { ...input, userId: req.user!.id, ...(batchRequestHash ? { batchRequestHash } : {}) });
  const payingShift = await lockCurrentDrawer(tx, req, false);
  await lockSale(tx, id);
  const sale = await tx.sale.findUnique({ where: { id }, include: { items: true, refunds: true, payments: true } });
  if (!sale) throw new AppError('Sale not found', 404);
  assertOwnsRecord(req, sale.locationId);
  if (sale.sourceType === 'DAILY_SUMMARY') throw new AppError('Historical daily summaries cannot be refunded or voided as receipts.', 409);
  if (!sale.locationId) throw new AppError('Assign this sale to a store before reversing it', 409);
  if (input.idempotencyKey) {
    const previous = await tx.saleVoid.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (previous) {
      if (previous.saleId !== id || previous.userId !== req.user!.id || previous.requestHash !== hash) throw new AppError('This void retry key belongs to a different request', 409);
      return { ...sale, voidEvent: previous, replayed: true };
    }
  }
  assertReversalTendersAvailable(sale);
  const approval = await requireTransactionApproval(req, tx, 'sale.reverse');
  if (sale.status === SaleStatus.VOIDED) throw new AppError('Sale already voided', 400);
  if (sale.status !== SaleStatus.COMPLETED) throw new AppError('Only completed sales can be voided', 400);
  if (sale.refunds.length) throw new AppError('This sale has refunds. Refund the remaining balance instead of voiding it.', 400);
  if (await tx.saleItemCorrection.count({ where: { saleId: sale.id } })) throw new AppError('A line on this sale had its product corrected. Refund it without restocking instead of voiding.', 409);
  if (input.expectedAmount !== undefined && cents(input.expectedAmount) !== cents(Number(sale.total))) throw new AppError('Sale amount changed. Reload and review the void.', 409);
  const internalTenders = ['GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT'];
  if ((!sale.payments.length && internalTenders.includes(sale.paymentMethod))
    || sale.payments.some(payment => Number(payment.amount) > 0 && ((payment.paymentMethod === 'GIFT_CARD' && !payment.reference)
      || (['STORE_CREDIT', 'HOUSE_ACCOUNT'].includes(payment.paymentMethod) && !sale.customerId)))) {
    throw new AppError('Original account payment details are missing. Reconcile this sale before voiding it.', 409);
  }
  const cashReturned = dollars(saleTenderAmounts(sale).CASH || 0);
  if (cashReturned > 0 && !payingShift) throw new AppError('Clock in before voiding a cash sale. The payout must belong to your current drawer.', 400);
  await lockInventory(tx, sale.items.map(item => item.productId));
  if (sale.customerId) await tx.$queryRaw`SELECT id FROM customers WHERE id = ${sale.customerId} FOR UPDATE`;
  // A void reverses the original internal tender; externally processed card refunds remain manual.
  for (const payment of [...sale.payments].sort((a, b) => (a.paymentMethod + ':' + (a.reference || '')).localeCompare(b.paymentMethod + ':' + (b.reference || '')))) {
    if (payment.paymentMethod === 'GIFT_CARD') {
      await tx.$queryRaw`SELECT id FROM gift_cards WHERE code = ${payment.reference} OR id = ${payment.reference} FOR UPDATE`;
      const card = await tx.giftCard.findFirst({ where: { OR: [{ code: payment.reference || '' }, { id: payment.reference || '' }] } });
      if (!card) throw new AppError('Original gift card is missing; cannot void safely', 409);
      assertCanReadRecord(req, card.locationId);
      await tx.giftCard.update({ where: { id: card.id }, data: { currentBalance: { increment: payment.amount }, transactions: { create: { type: 'REFUND', amount: payment.amount, balanceBefore: card.currentBalance, balanceAfter: Number(card.currentBalance) + Number(payment.amount), saleId: id } } } });
    }
    if (payment.paymentMethod === 'STORE_CREDIT' && sale.customerId) {
      await tx.$queryRaw`SELECT id FROM store_credit_accounts WHERE "customerId" = ${sale.customerId} FOR UPDATE`;
      const account = await tx.storeCreditAccount.findUnique({ where: { customerId: sale.customerId } });
      if (!account) throw new AppError('Original store credit account is missing', 409);
      assertCanReadRecord(req, account.locationId);
      await tx.storeCreditAccount.update({ where: { id: account.id }, data: { balance: { increment: payment.amount }, transactions: { create: { type: 'CREDIT', amount: payment.amount, balanceBefore: account.balance, balanceAfter: Number(account.balance) + Number(payment.amount), saleId: id } } } });
    }
    if (payment.paymentMethod === 'HOUSE_ACCOUNT' && sale.customerId) {
      await tx.$queryRaw`SELECT id FROM house_accounts WHERE "customerId" = ${sale.customerId} FOR UPDATE`;
      const account = await tx.houseAccount.findUnique({ where: { customerId: sale.customerId } });
      if (!account) throw new AppError('Original house account is missing', 409);
      assertCanReadRecord(req, account.locationId);
      if (cents(account.balance) < cents(payment.amount)) throw new AppError('Original house charge has already been paid down. Review its refund using explicit customer store credit.', 409);
      await tx.houseAccount.update({ where: { id: account.id }, data: { balance: { decrement: payment.amount }, transactions: { create: { type: 'ADJUSTMENT', amount: -Number(payment.amount), balanceBefore: account.balance, balanceAfter: Number(account.balance) - Number(payment.amount), saleId: id, notes: 'Voided sale' } } } });
    }
  }
  for (const item of [...sale.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const product = await tx.product.findUnique({ where: { id: item.productId } });
    if (!product?.trackInventory) {
      if (product && item.inventoryEntryId) await postNonstockCost(tx, { productId: item.productId, locationId: sale.locationId!, userId: req.user!.id,
        sourceId: sale.id, sourceKey: 'void-line:' + item.id, kind: 'VOID_RETURN', quantity: item.quantity, cost: item.costAmount, referenceEntryId: item.inventoryEntryId });
      continue;
    }
    await moveInventory(tx, { productId: item.productId, locationId: sale.locationId!, userId: req.user!.id, type: 'RETURN', costKind: 'VOID_RETURN', sourceId: sale.id,
      sourceKey: 'void-line:' + item.id, quantity: item.quantity, valueMode: item.inventoryEntryId ? 'REFERENCE' : 'FIXED',
      referenceEntryId: item.inventoryEntryId, referenceQuantity: item.quantity,
      valueInput: item.costAmount ?? (item.inventoryEntryId || item.unitCost === null ? null : item.unitCost.mul(item.quantity)), notes: 'Voided sale ' + sale.saleNumber });
  }
  if (sale.customerId) {
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${sale.customerId} FOR UPDATE`;
    const customer = await tx.customer.findUnique({ where: { id: sale.customerId } });
    if (customer) await tx.customer.update({ where: { id: customer.id }, data: { totalSpent: Math.max(0, Math.round((Number(customer.totalSpent) - Number(sale.total)) * 100) / 100), loyaltyPoints: sale.pricingVersion ? customer.loyaltyPoints + (sale.pointsRedeemed || 0) - (sale.pointsEarned || 0) : Math.max(0, customer.loyaltyPoints - Math.floor(Number(sale.total))), ...(sale.pricingVersion ? { loyaltyTier: tierForPoints(customer.loyaltyPoints + (sale.pointsRedeemed || 0) - (sale.pointsEarned || 0)) } : {}), visitCount: Math.max(0, customer.visitCount - 1) } });
  }
  if (cashReturned > 0) {
    await postDrawerEntry(tx, { sourceKey: 'void:' + sale.id, shiftId: payingShift!.id, locationId: sale.locationId, userId: req.user!.id, saleId: sale.id, type: 'VOID', amount: -cashReturned });
  }
  const snapshotItems = sale.items.map(item => ({ saleItemId: item.id, productId: item.productId, productName: item.productName, sku: item.sku,
    quantity: item.quantity, amount: Number(item.total), taxAmount: Number(item.tax), unitCost: item.unitCost === null ? null : Number(item.unitCost),
    costReversed: item.costAmount?.toNumber() ?? (item.inventoryEntryId || item.unitCost === null ? null : new Prisma.Decimal(item.unitCost).mul(item.quantity).toNumber()) }));
  const costReversed = snapshotItems.length && snapshotItems.every(item => item.costReversed !== null)
    ? snapshotItems.reduce((sum, item) => sum.plus(item.costReversed!), new Prisma.Decimal(0)) : null;
  const voidEvent = await tx.saleVoid.create({ data: { saleId: id, locationId: sale.locationId, userId: req.user!.id, approvalId: approval?.id,
    shiftId: payingShift?.id, reason: input.reason, amount: sale.total, taxAmount: sale.tax, discount: sale.discount,
    costReversed, pointsRestored: sale.pointsRedeemed, pointsReversed: sale.pointsEarned, items: snapshotItems,
    tenders: Object.fromEntries(Object.entries(saleTenderAmounts(sale)).map(([method, amount]) => [method, dollars(amount)])),
    idempotencyKey: input.idempotencyKey, requestHash: hash } });
  const updated = await tx.sale.update({ where: { id }, data: { status: SaleStatus.VOIDED } });
  await tx.activityLog.create({ data: { userId: req.user!.id, action: 'VOID', entity: 'SALE', entityId: id, locationId: sale.locationId, details: { saleNumber: sale.saleNumber, voidId: voidEvent.id, reason: input.reason, amount: sale.total, approvalId: approval?.id || null } } });
  return { ...updated, voidEvent, replayed: false };
};
