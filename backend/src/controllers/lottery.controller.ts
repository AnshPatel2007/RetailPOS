import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { LotteryBatchStatus, LotteryTransactionStatus } from '@prisma/client';
import { getLocationFilter } from '../utils/locationFilter.util';

/**
 * LOTTERY BATCH CONTROLLERS
 */

// Get all batches
export const getBatches = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { gameType, status, page = 1, limit = 20, locationId } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  const locationFilter = getLocationFilter(req, locationId as string | undefined);

  const where: any = {};

  if (locationFilter.locationId) {
    where.locationId = locationFilter.locationId;
  }

  if (gameType) {
    where.gameType = gameType;
  }

  if (status) {
    where.status = status;
  }

  const [batches, total] = await Promise.all([
    prisma.lotteryBatch.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            scans: true,
          },
        },
      },
    }),
    prisma.lotteryBatch.count({ where }),
  ]);

  res.json({
    success: true,
    data: batches,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

// Get single batch
export const getBatchById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const batch = await prisma.lotteryBatch.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      scans: {
        orderBy: { scannedAt: 'desc' },
        take: 10,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      },
      _count: {
        select: {
          scans: true,
        },
      },
    },
  });

  if (!batch) {
    throw new AppError('Batch not found', 404);
  }

  res.json({
    success: true,
    data: batch,
  });
});

// Create batch
export const createBatch = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { batchNumber, gameType, startTicketNum, endTicketNum, totalTickets, pricePerTicket, notes } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  // Check if batch number already exists for this location
  const existing = await prisma.lotteryBatch.findFirst({
    where: {
      batchNumber,
      locationId: req.user.locationId,
    },
  });

  if (existing) {
    throw new AppError('Batch number already exists', 400);
  }

  const batch = await prisma.lotteryBatch.create({
    data: {
      batchNumber,
      gameType,
      startTicketNum,
      endTicketNum,
      totalTickets,
      remainingTickets: totalTickets,
      pricePerTicket,
      status: LotteryBatchStatus.ACTIVE,
      activatedAt: new Date(),
      userId: req.user.id,
      locationId: req.user.locationId,
      notes,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'CREATE',
      entity: 'LOTTERY_BATCH',
      entityId: batch.id,
      details: { batchNumber, gameType, totalTickets },
      locationId: req.user.locationId,
    },
  });

  logger.info(`Lottery batch created: ${batchNumber} by user ${req.user.id}`);

  res.status(201).json({
    success: true,
    data: batch,
    message: 'Lottery batch created successfully',
  });
});

// Update batch
export const updateBatch = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const updateData = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const batch = await prisma.lotteryBatch.findUnique({
    where: { id },
  });

  if (!batch) {
    throw new AppError('Batch not found', 404);
  }

  // Check if status is changing to DEPLETED
  if (updateData.status === LotteryBatchStatus.DEPLETED && batch.status !== LotteryBatchStatus.DEPLETED) {
    updateData.depletedAt = new Date();
  }

  const updatedBatch = await prisma.lotteryBatch.update({
    where: { id },
    data: updateData,
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'UPDATE',
      entity: 'LOTTERY_BATCH',
      entityId: updatedBatch.id,
      details: { batchNumber: updatedBatch.batchNumber, changes: updateData },
      locationId: req.user.locationId,
    },
  });

  logger.info(`Lottery batch updated: ${updatedBatch.batchNumber} by user ${req.user.id}`);

  res.json({
    success: true,
    data: updatedBatch,
    message: 'Batch updated successfully',
  });
});

// Delete batch
export const deleteBatch = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const batch = await prisma.lotteryBatch.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          scans: true,
        },
      },
    },
  });

  if (!batch) {
    throw new AppError('Batch not found', 404);
  }

  if (batch._count.scans > 0) {
    throw new AppError('Cannot delete batch with scanned tickets', 400);
  }

  await prisma.lotteryBatch.delete({
    where: { id },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'DELETE',
      entity: 'LOTTERY_BATCH',
      entityId: id,
      details: { batchNumber: batch.batchNumber },
      locationId: req.user.locationId,
    },
  });

  logger.info(`Lottery batch deleted: ${batch.batchNumber} by user ${req.user.id}`);

  res.json({
    success: true,
    message: 'Batch deleted successfully',
  });
});

/**
 * LOTTERY TRANSACTION CONTROLLERS
 */

// Get all transactions
export const getTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, status, page = 1, limit = 20, locationId } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  const locationFilter = getLocationFilter(req, locationId as string | undefined);

  const where: any = {};

  if (locationFilter.locationId) {
    where.locationId = locationFilter.locationId;
  }

  if (startDate || endDate) {
    where.transactionDate = {};
    if (startDate) {
      where.transactionDate.gte = new Date(startDate as string);
    }
    if (endDate) {
      where.transactionDate.lte = new Date(endDate as string);
    }
  }

  if (status) {
    where.status = status;
  }

  const [transactions, total] = await Promise.all([
    prisma.lotteryTransaction.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { transactionDate: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            scans: true,
          },
        },
      },
    }),
    prisma.lotteryTransaction.count({ where }),
  ]);

  res.json({
    success: true,
    data: transactions,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

// Get single transaction
export const getTransactionById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const transaction = await prisma.lotteryTransaction.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      scans: {
        orderBy: { scannedAt: 'desc' },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
          batch: {
            select: {
              batchNumber: true,
              gameType: true,
            },
          },
        },
      },
      _count: {
        select: {
          scans: true,
        },
      },
    },
  });

  if (!transaction) {
    throw new AppError('Transaction not found', 404);
  }

  res.json({
    success: true,
    data: transaction,
  });
});

// Create or update transaction (for a specific date)
export const upsertTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    transactionDate,
    onlineSalesCount,
    onlineSalesAmount,
    offlineSalesCount,
    offlineSalesAmount,
    cashoutAmount,
    notes,
  } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const date = new Date(transactionDate);
  date.setHours(0, 0, 0, 0);

  // Calculate net amount
  const netAmount =
    (onlineSalesAmount || 0) + (offlineSalesAmount || 0) - (cashoutAmount || 0);

  const transaction = await prisma.lotteryTransaction.upsert({
    where: {
      transactionDate_locationId: {
        transactionDate: date,
        locationId: req.user.locationId || '',
      },
    },
    create: {
      transactionDate: date,
      onlineSalesCount: onlineSalesCount || 0,
      onlineSalesAmount: onlineSalesAmount || 0,
      offlineSalesCount: offlineSalesCount || 0,
      offlineSalesAmount: offlineSalesAmount || 0,
      cashoutAmount: cashoutAmount || 0,
      netAmount,
      userId: req.user.id,
      locationId: req.user.locationId,
      notes,
      status: LotteryTransactionStatus.OPEN,
    },
    update: {
      onlineSalesCount: onlineSalesCount || 0,
      onlineSalesAmount: onlineSalesAmount || 0,
      offlineSalesCount: offlineSalesCount || 0,
      offlineSalesAmount: offlineSalesAmount || 0,
      cashoutAmount: cashoutAmount || 0,
      netAmount,
      notes,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'UPDATE',
      entity: 'LOTTERY_TRANSACTION',
      entityId: transaction.id,
      details: { date: date.toISOString(), netAmount },
      locationId: req.user.locationId,
    },
  });

  logger.info(`Lottery transaction updated for date: ${date.toISOString()} by user ${req.user.id}`);

  res.json({
    success: true,
    data: transaction,
    message: 'Transaction saved successfully',
  });
});

// Close transaction (lock for editing)
export const closeTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { notes } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  // Check user has permission (MANAGER or above)
  if (!['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw new AppError('Insufficient permissions to close transactions', 403);
  }

  const transaction = await prisma.lotteryTransaction.findUnique({
    where: { id },
  });

  if (!transaction) {
    throw new AppError('Transaction not found', 404);
  }

  if (transaction.status !== LotteryTransactionStatus.OPEN) {
    throw new AppError('Transaction is already closed', 400);
  }

  const updatedTransaction = await prisma.lotteryTransaction.update({
    where: { id },
    data: {
      status: LotteryTransactionStatus.CLOSED,
      closedAt: new Date(),
      closedBy: req.user.id,
      notes: notes || transaction.notes,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'CLOSE',
      entity: 'LOTTERY_TRANSACTION',
      entityId: updatedTransaction.id,
      details: { date: updatedTransaction.transactionDate.toISOString() },
      locationId: req.user.locationId,
    },
  });

  logger.info(`Lottery transaction closed: ${updatedTransaction.id} by user ${req.user.id}`);

  res.json({
    success: true,
    data: updatedTransaction,
    message: 'Transaction closed successfully',
  });
});

/**
 * LOTTERY TICKET SCAN CONTROLLERS
 */

// Scan ticket
export const scanTicket = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { barcode, ticketNumber, batchId, gameType, amount, notes } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  // Get or create today's transaction
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let transaction = await prisma.lotteryTransaction.findFirst({
    where: {
      transactionDate: today,
      locationId: req.user.locationId,
    },
  });

  if (!transaction) {
    transaction = await prisma.lotteryTransaction.create({
      data: {
        transactionDate: today,
        userId: req.user.id,
        locationId: req.user.locationId,
        status: LotteryTransactionStatus.OPEN,
      },
    });
  }

  // Create the scan record
  const scan = await prisma.lotteryTicketScan.create({
    data: {
      barcode,
      ticketNumber,
      batchId,
      transactionId: transaction.id,
      gameType,
      amount,
      userId: req.user.id,
      locationId: req.user.locationId,
      notes,
    },
    include: {
      batch: {
        select: {
          batchNumber: true,
          gameType: true,
          pricePerTicket: true,
        },
      },
      transaction: {
        select: {
          id: true,
          transactionDate: true,
        },
      },
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  // Update batch remaining tickets if batch is specified
  if (batchId) {
    await prisma.lotteryBatch.update({
      where: { id: batchId },
      data: {
        remainingTickets: {
          decrement: 1,
        },
      },
    });

    // Check if batch is depleted
    const batch = await prisma.lotteryBatch.findUnique({
      where: { id: batchId },
    });

    if (batch && batch.remainingTickets <= 0) {
      await prisma.lotteryBatch.update({
        where: { id: batchId },
        data: {
          status: LotteryBatchStatus.DEPLETED,
          depletedAt: new Date(),
        },
      });
    }
  }

  // Update transaction offline count and amount
  const scanAmount = amount || scan.batch?.pricePerTicket || 0;
  await prisma.lotteryTransaction.update({
    where: { id: transaction.id },
    data: {
      offlineSalesCount: {
        increment: 1,
      },
      offlineSalesAmount: {
        increment: scanAmount,
      },
      netAmount: {
        increment: scanAmount,
      },
    },
  });

  logger.info(`Lottery ticket scanned: ${barcode} by user ${req.user.id}`);

  res.status(201).json({
    success: true,
    data: scan,
    message: 'Ticket scanned successfully',
  });
});

// Get scans
export const getScans = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, batchId, transactionId, page = 1, limit = 50, locationId } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  const locationFilter = getLocationFilter(req, locationId as string | undefined);

  const where: any = {};

  if (locationFilter.locationId) {
    where.locationId = locationFilter.locationId;
  }

  if (startDate || endDate) {
    where.scannedAt = {};
    if (startDate) {
      where.scannedAt.gte = new Date(startDate as string);
    }
    if (endDate) {
      where.scannedAt.lte = new Date(endDate as string);
    }
  }

  if (batchId) {
    where.batchId = batchId;
  }

  if (transactionId) {
    where.transactionId = transactionId;
  }

  const [scans, total] = await Promise.all([
    prisma.lotteryTicketScan.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { scannedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        batch: {
          select: {
            batchNumber: true,
            gameType: true,
          },
        },
        transaction: {
          select: {
            id: true,
            transactionDate: true,
          },
        },
      },
    }),
    prisma.lotteryTicketScan.count({ where }),
  ]);

  res.json({
    success: true,
    data: scans,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * REPORTS
 */

// Get daily summary report
export const getDailySummary = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, locationId } = req.query;

  const locationFilter = getLocationFilter(req, locationId as string | undefined);

  const where: any = {};

  if (locationFilter.locationId) {
    where.locationId = locationFilter.locationId;
  }

  if (startDate || endDate) {
    where.transactionDate = {};
    if (startDate) {
      where.transactionDate.gte = new Date(startDate as string);
    }
    if (endDate) {
      where.transactionDate.lte = new Date(endDate as string);
    }
  }

  const summary = await prisma.lotteryTransaction.aggregate({
    where,
    _sum: {
      onlineSalesCount: true,
      onlineSalesAmount: true,
      offlineSalesCount: true,
      offlineSalesAmount: true,
      cashoutAmount: true,
      netAmount: true,
    },
    _count: true,
  });

  res.json({
    success: true,
    data: {
      totalDays: summary._count,
      totalOnlineTickets: summary._sum.onlineSalesCount || 0,
      totalOnlineSales: summary._sum.onlineSalesAmount || 0,
      totalOfflineTickets: summary._sum.offlineSalesCount || 0,
      totalOfflineSales: summary._sum.offlineSalesAmount || 0,
      totalCashout: summary._sum.cashoutAmount || 0,
      totalNet: summary._sum.netAmount || 0,
      totalTickets: (summary._sum.onlineSalesCount || 0) + (summary._sum.offlineSalesCount || 0),
      totalSales: (summary._sum.onlineSalesAmount || 0) + (summary._sum.offlineSalesAmount || 0),
    },
  });
});
