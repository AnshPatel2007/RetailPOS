import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { createDateFilter } from '../utils/dateFilter.util';

/**
 * Clock in (start shift)
 * POST /api/shifts/clock-in
 */
export const clockIn = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startingCash = 0 } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  // Check if user has an open shift
  const openShift = await prisma.shift.findFirst({
    where: {
      userId: req.user.id,
      isClosed: false,
    },
  });

  if (openShift) {
    throw new AppError('You already have an open shift', 400);
  }

  const shift = await prisma.shift.create({
    data: {
      userId: req.user.id,
      locationId: req.user.locationId,
      clockInAt: new Date(),
      startingCash,
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

  logger.info(`User ${req.user.email} clocked in`);

  res.status(201).json({
    success: true,
    data: shift,
    message: 'Clocked in successfully',
  });
});

/**
 * Clock out (end shift)
 * POST /api/shifts/clock-out
 */
export const clockOut = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { endingCash } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const openShift = await prisma.shift.findFirst({
    where: {
      userId: req.user.id,
      isClosed: false,
    },
    include: {
      sales: {
        where: { status: 'COMPLETED' },
        select: { paymentMethod: true, total: true, changeDue: true, payments: true },
      },
    },
    orderBy: {
      clockInAt: 'desc',
    },
  });

  if (!openShift) {
    throw new AppError('No open shift found', 404);
  }

  // Calculate cash that should be in the drawer:
  // For each sale, sum the cash portion paid minus change given back
  let cashIn = 0;
  for (const sale of openShift.sales) {
    if (sale.payments && sale.payments.length > 0) {
      // Split payment — sum only CASH portions
      for (const p of sale.payments) {
        if (p.paymentMethod === 'CASH') {
          cashIn += p.amount;
        }
      }
      // Subtract change given back (change is always cash)
      cashIn -= sale.changeDue || 0;
    } else if (sale.paymentMethod === 'CASH') {
      // Single cash payment — total paid minus change
      cashIn += sale.total; // net cash kept = total (amountPaid - changeDue = total for exact/over payments)
    }
    // Non-cash single payments don't affect the drawer
  }
  cashIn = Math.round(cashIn * 100) / 100;

  const expectedCash = Math.round((openShift.startingCash + cashIn) * 100) / 100;
  const cashDifference = Math.round((endingCash - expectedCash) * 100) / 100;

  const shift = await prisma.shift.update({
    where: { id: openShift.id },
    data: {
      clockOutAt: new Date(),
      endingCash,
      expectedCash,
      cashDifference,
      isClosed: true,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  logger.info(`User ${req.user.email} clocked out`);

  res.json({
    success: true,
    data: shift,
    message: 'Clocked out successfully',
  });
});

/**
 * Close shift
 * POST /api/shifts/:id/close
 */
export const closeShift = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { notes } = req.body;

  const shift = await prisma.shift.findUnique({ where: { id } });

  if (!shift) {
    throw new AppError('Shift not found', 404);
  }

  if (shift.isClosed) {
    throw new AppError('Shift already closed', 400);
  }

  const closedShift = await prisma.shift.update({
    where: { id },
    data: {
      isClosed: true,
      notes,
    },
    include: {
      user: true,
      sales: {
        select: {
          id: true,
          saleNumber: true,
          total: true,
          paymentMethod: true,
        },
      },
    },
  });

  logger.info(`Shift ${id} closed`);

  res.json({
    success: true,
    data: closedShift,
    message: 'Shift closed successfully',
  });
});

/**
 * Get all shifts
 * GET /api/shifts
 */
export const getShifts = asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 20, userId, startDate, endDate } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  const where: any = {};

  if (userId) where.userId = userId;

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) {
    where.clockInAt = dateFilter;
  }

  const [shifts, total] = await Promise.all([
    prisma.shift.findMany({
      where,
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
      skip,
      take: limitNum,
      orderBy: { clockInAt: 'desc' },
    }),
    prisma.shift.count({ where }),
  ]);

  res.json({
    success: true,
    data: shifts,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * Get current shift for user
 * GET /api/shifts/current
 */
export const getCurrentShift = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const shift = await prisma.shift.findFirst({
    where: {
      userId: req.user.id,
      isClosed: false,
    },
    include: {
      sales: {
        where: { status: 'COMPLETED' },
        select: {
          id: true,
          saleNumber: true,
          total: true,
          paymentMethod: true,
          changeDue: true,
          createdAt: true,
          payments: {
            select: { paymentMethod: true, amount: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: {
      clockInAt: 'desc',
    },
  });

  // Calculate cash-only total for expected drawer amount
  let totalCashSales = 0;
  if (shift) {
    for (const sale of shift.sales) {
      if (sale.payments && sale.payments.length > 0) {
        for (const p of sale.payments) {
          if (p.paymentMethod === 'CASH') totalCashSales += p.amount;
        }
        totalCashSales -= sale.changeDue || 0;
      } else if (sale.paymentMethod === 'CASH') {
        totalCashSales += sale.total;
      }
    }
    totalCashSales = Math.round(totalCashSales * 100) / 100;
  }

  res.json({
    success: true,
    data: shift ? { ...shift, totalCashSales } : null,
  });
});

/**
 * Get employee performance metrics
 * GET /api/shifts/employee-performance
 */
export const getEmployeePerformance = asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate, userId, locationId } = req.query;

  const dateFilter = createDateFilter(startDate as string, endDate as string);

  const shiftWhere: any = {};
  if (dateFilter) shiftWhere.clockInAt = dateFilter;
  if (userId) shiftWhere.userId = userId;
  if (locationId) shiftWhere.locationId = locationId;

  const saleWhere: any = { status: 'COMPLETED' };
  if (dateFilter) saleWhere.createdAt = dateFilter;
  if (userId) saleWhere.userId = userId;
  if (locationId) saleWhere.locationId = locationId;

  // Get shifts data
  const shifts = await prisma.shift.findMany({
    where: shiftWhere,
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      },
    },
  });

  // Get sales data
  const sales = await prisma.sale.findMany({
    where: saleWhere,
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      items: true,
    },
  });

  // Calculate performance metrics per employee
  const performanceMap = new Map<string, any>();

  // Process shifts
  for (const shift of shifts) {
    const userId = shift.userId;
    const userName = `${shift.user.firstName} ${shift.user.lastName}`;

    if (!performanceMap.has(userId)) {
      performanceMap.set(userId, {
        id: userId,
        name: userName,
        role: shift.user.role,
        totalSales: 0,
        totalTransactions: 0,
        totalHoursWorked: 0,
        totalCashDifference: 0,
        averageOrderValue: 0,
        salesPerHour: 0,
        cashAccuracy: 0,
        shiftCount: 0,
        itemsSold: 0,
      });
    }

    const metrics = performanceMap.get(userId);
    metrics.shiftCount++;

    // Calculate hours worked
    if (shift.clockOutAt) {
      const hoursWorked =
        (new Date(shift.clockOutAt).getTime() - new Date(shift.clockInAt).getTime()) /
        (1000 * 60 * 60);
      metrics.totalHoursWorked += hoursWorked;
    }

    // Cash difference
    if (shift.cashDifference !== null) {
      metrics.totalCashDifference += Math.abs(shift.cashDifference);
    }
  }

  // Process sales
  for (const sale of sales) {
    const userId = sale.userId;

    if (performanceMap.has(userId)) {
      const metrics = performanceMap.get(userId);
      metrics.totalSales += sale.total;
      metrics.totalTransactions++;
      metrics.itemsSold += sale.items.reduce((sum, item) => sum + item.quantity, 0);
    }
  }

  // Calculate derived metrics
  for (const [_userId, metrics] of performanceMap.entries()) {
    metrics.averageOrderValue =
      metrics.totalTransactions > 0 ? metrics.totalSales / metrics.totalTransactions : 0;
    metrics.salesPerHour =
      metrics.totalHoursWorked > 0 ? metrics.totalSales / metrics.totalHoursWorked : 0;
    metrics.cashAccuracy =
      metrics.shiftCount > 0
        ? ((metrics.shiftCount - metrics.totalCashDifference / 10) / metrics.shiftCount) * 100
        : 100;
    metrics.cashAccuracy = Math.max(0, Math.min(100, metrics.cashAccuracy)); // Clamp to 0-100
  }

  // Convert map to array and sort by total sales
  const performance = Array.from(performanceMap.values()).sort((a, b) => b.totalSales - a.totalSales);

  res.json({
    success: true,
    data: {
      performance,
      summary: {
        totalEmployees: performance.length,
        totalSales: performance.reduce((sum, p) => sum + p.totalSales, 0),
        totalTransactions: performance.reduce((sum, p) => sum + p.totalTransactions, 0),
        totalHoursWorked: performance.reduce((sum, p) => sum + p.totalHoursWorked, 0),
      },
    },
  });
});
