import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';

/**
 * Get all transfers
 * GET /api/inventory-transfers
 */
export const getTransfers = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '20', status, locationId } = req.query;
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const where: any = {};
  if (status) where.status = status;
  if (locationId) {
    where.OR = [{ fromLocationId: locationId }, { toLocationId: locationId }];
  }

  const [transfers, total] = await Promise.all([
    prisma.inventoryTransfer.findMany({
      where,
      include: { items: { include: {} } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
    }),
    prisma.inventoryTransfer.count({ where }),
  ]);

  res.json({ success: true, data: transfers, total });
});

/**
 * Get transfer by ID
 * GET /api/inventory-transfers/:id
 */
export const getTransfer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const transfer = await prisma.inventoryTransfer.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!transfer) throw new AppError('Transfer not found', 404);
  res.json({ success: true, data: transfer });
});

/**
 * Create a new inventory transfer
 * POST /api/inventory-transfers
 */
export const createTransfer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { fromLocationId, toLocationId, items, notes } = req.body;

  if (!fromLocationId || !toLocationId || !items?.length) {
    throw new AppError('Missing required fields', 400);
  }
  if (fromLocationId === toLocationId) {
    throw new AppError('Source and destination must be different', 400);
  }

  const transferNumber = `TRF-${Date.now()}`;

  const transfer = await prisma.$transaction(async (tx) => {
    const t = await tx.inventoryTransfer.create({
      data: {
        transferNumber,
        fromLocationId,
        toLocationId,
        status: 'PENDING',
        notes,
        createdBy: req.user!.id,
        items: {
          create: items.map((item: { productId: string; quantity: number }) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        },
      },
      include: { items: true },
    });

    return t;
  });

  logger.info(`Transfer created: ${transferNumber}`);
  res.status(201).json({ success: true, data: transfer, message: 'Transfer created' });
});

/**
 * Ship a transfer (deduct from source location)
 * POST /api/inventory-transfers/:id/ship
 */
export const shipTransfer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const transfer = await prisma.inventoryTransfer.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!transfer) throw new AppError('Transfer not found', 404);
  if (transfer.status !== 'PENDING') throw new AppError('Transfer is not in PENDING status', 400);

  await prisma.$transaction(async (tx) => {
    // Deduct stock from source products
    for (const item of transfer.items) {
      await tx.product.updateMany({
        where: { id: item.productId, locationId: transfer.fromLocationId },
        data: { stockQuantity: { decrement: item.quantity } },
      });
    }

    await tx.inventoryTransfer.update({
      where: { id },
      data: { status: 'IN_TRANSIT', shippedAt: new Date() },
    });
  });

  logger.info(`Transfer shipped: ${transfer.transferNumber}`);
  res.json({ success: true, message: 'Transfer shipped' });
});

/**
 * Receive a transfer (add to destination location)
 * POST /api/inventory-transfers/:id/receive
 */
export const receiveTransfer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { receivedItems } = req.body; // [{productId, receivedQty}]

  const transfer = await prisma.inventoryTransfer.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!transfer) throw new AppError('Transfer not found', 404);
  if (transfer.status !== 'IN_TRANSIT') throw new AppError('Transfer is not in transit', 400);

  await prisma.$transaction(async (tx) => {
    for (const item of transfer.items) {
      const received = receivedItems?.find((r: any) => r.productId === item.productId);
      const qty = received?.receivedQty ?? item.quantity;

      // Update received qty on transfer item
      await tx.transferItem.update({
        where: { id: item.id },
        data: { receivedQty: qty },
      });

      // Add stock to destination products
      await tx.product.updateMany({
        where: { id: item.productId, locationId: transfer.toLocationId },
        data: { stockQuantity: { increment: qty } },
      });
    }

    await tx.inventoryTransfer.update({
      where: { id },
      data: { status: 'RECEIVED', receivedAt: new Date() },
    });
  });

  logger.info(`Transfer received: ${transfer.transferNumber}`);
  res.json({ success: true, message: 'Transfer received' });
});

/**
 * Cancel a transfer
 * POST /api/inventory-transfers/:id/cancel
 */
export const cancelTransfer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const transfer = await prisma.inventoryTransfer.findUnique({ where: { id } });
  if (!transfer) throw new AppError('Transfer not found', 404);
  if (transfer.status === 'RECEIVED') throw new AppError('Cannot cancel a received transfer', 400);

  await prisma.inventoryTransfer.update({
    where: { id },
    data: { status: 'CANCELLED' },
  });

  logger.info(`Transfer cancelled: ${transfer.transferNumber}`);
  res.json({ success: true, message: 'Transfer cancelled' });
});
