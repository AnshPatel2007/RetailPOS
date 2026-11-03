import { Response } from 'express';
import { nextDocumentNumber } from '../services/documentNumber.service';
import { refundSaleInTransaction, lockSale } from '../services/saleReversal.service';
import { lockCurrentDrawer } from '../services/drawer.service';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { assertOwnsRecord, getLocationFilter } from '../utils/locationFilter.util';

/**
 * Get all exchanges
 * GET /api/exchanges
 */
export const getExchanges = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '20', status } = req.query;
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const where: any = { ...getLocationFilter(req, req.query.locationId as string) };
  if (status) where.status = status;

  const [exchanges, total] = await Promise.all([
    prisma.exchange.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
    }),
    prisma.exchange.count({ where }),
  ]);

  res.json({ success: true, data: exchanges, total });
});

/**
 * Get exchange by ID
 * GET /api/exchanges/:id
 */
export const getExchange = asyncHandler(async (req: AuthRequest, res: Response) => {
  const exchange = await prisma.exchange.findUnique({ where: { id: req.params.id } });
  if (!exchange) throw new AppError('Exchange not found', 404);
  assertOwnsRecord(req, exchange.locationId);
  res.json({ success: true, data: exchange });
});

/**
 * Process a return/exchange
 * POST /api/exchanges
 */
export const createExchange = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { originalSaleId, type, reason, returnedItems, notes } = req.body;
  if (type !== 'RETURN_ONLY') throw new AppError('Use a return followed by a new sale for replacement items', 400);
  if (!originalSaleId || typeof reason !== 'string' || !reason.trim() || !Array.isArray(returnedItems) || !returnedItems.length) {
    throw new AppError('Original sale, reason and returned items are required', 400);
  }
  const exchange = await prisma.$transaction(async tx => {
    await lockCurrentDrawer(tx, req);
    await lockSale(tx, originalSaleId);
    const sale = await tx.sale.findUnique({ where: { id: originalSaleId }, include: { items: true, refunds: true } });
    if (!sale) throw new AppError('Original sale not found', 404);
    assertOwnsRecord(req, sale.locationId);
    const items = returnedItems.map((item: any) => {
      const matches = sale.items.filter(line => item.saleItemId ? line.id === item.saleItemId : line.productId === item.productId);
      if (matches.length !== 1 || !Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new AppError('Specify a valid original sale item and positive return quantity', 400);
      }
      return { saleItemId: matches[0].id, quantity: item.quantity };
    });
    const refundRequest = { user: req.user, params: { id: originalSaleId }, body: { items, reason, notes, refundMethod: 'CASH' } } as unknown as AuthRequest;
    const { sale: updated } = await refundSaleInTransaction(refundRequest, tx);
    const priorTotal = sale.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
    const refunded = updated.refunds.reduce((sum, r) => sum + Number(r.amount), 0) - priorTotal;
    return tx.exchange.create({ data: {
      exchangeNumber: await nextDocumentNumber('EX', tx), originalSaleId, type, status: 'COMPLETED', reason,
      returnedItems: items, notes, processedBy: req.user!.id, locationId: sale.locationId,
      priceDifference: -Math.round(refunded * 100) / 100,
    } });
  });
  logger.info('Return processed: ' + exchange.exchangeNumber);
  res.status(201).json({ success: true, data: exchange, message: 'Return processed' });
});
