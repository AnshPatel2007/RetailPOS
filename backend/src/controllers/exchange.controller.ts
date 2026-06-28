import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';

/**
 * Get all exchanges
 * GET /api/exchanges
 */
export const getExchanges = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '20', status } = req.query;
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const where: any = {};
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
  res.json({ success: true, data: exchange });
});

/**
 * Process a return/exchange
 * POST /api/exchanges
 */
export const createExchange = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { originalSaleId, type, reason, returnedItems, notes } = req.body;

  if (!originalSaleId || !type || !reason || !returnedItems?.length) {
    throw new AppError('Missing required fields', 400);
  }

  // Verify original sale
  const sale = await prisma.sale.findUnique({
    where: { id: originalSaleId },
    include: { items: true },
  });
  if (!sale) throw new AppError('Original sale not found', 404);
  if (sale.status === 'REFUNDED') throw new AppError('Sale already fully refunded', 400);

  const exchangeNumber = `EX-${Date.now()}`;

  const exchange = await prisma.$transaction(async (tx) => {
    // Create exchange record
    const ex = await tx.exchange.create({
      data: {
        exchangeNumber,
        originalSaleId,
        type,
        status: 'COMPLETED',
        reason,
        returnedItems,
        notes,
        processedBy: req.user!.id,
      },
    });

    // Restore inventory for returned items
    for (const item of returnedItems as Array<{ productId: string; quantity: number; price: number }>) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stockQuantity: { increment: item.quantity } },
      });
    }

    // If RETURN_ONLY, calculate refund amount
    if (type === 'RETURN_ONLY') {
      const refundAmount = (returnedItems as Array<{ price: number; quantity: number }>)
        .reduce((sum: number, item: { price: number; quantity: number }) => sum + item.price * item.quantity, 0);

      await tx.exchange.update({
        where: { id: ex.id },
        data: { priceDifference: -refundAmount },
      });
    }

    return ex;
  });

  logger.info(`Exchange processed: ${exchangeNumber} (${type})`);
  res.status(201).json({ success: true, data: exchange, message: 'Exchange processed' });
});
