import { recordShiftWages, generatePayrollExpenses } from '../services/payroll.service';
import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { cashAmount, cents, dollars, drawerInclude, lockCurrentDrawer, lockDrawer, postDrawerEntry, summarizeDrawer } from '../services/drawer.service';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { createDateFilter } from '../utils/dateFilter.util';
import { assertOwnsRecord, getLocationFilter } from '../utils/locationFilter.util';

const CASH_MOVEMENT_TYPES = ['SAFE_DROP', 'PAID_IN', 'PAID_OUT'] as const;


/**
 * Clock in (start shift)
 * POST /api/shifts/clock-in
 */
export const clockIn = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startingCash = 0 } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  // Use transaction to prevent race condition on concurrent clock-in
  const shift = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user!.id} FOR UPDATE`;
    const employee = await tx.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { location: true } });
    const openShift = await tx.shift.findFirst({
      where: {
        userId: req.user!.id,
        isClosed: false,
      },
    });

    if (openShift) {
      throw new AppError('You already have an open shift', 400);
    }

    return tx.shift.create({
      data: {
        userId: req.user!.id,
        locationId: req.user!.locationId,
        clockInAt: new Date(),
        startingCash: cashAmount(startingCash, 'Starting cash'),
        hourlyRate: employee.hourlyRate,
        payrollFrequency: employee.location?.payrollFrequency,
        payrollTimezone: employee.location?.timezone,
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
  });

  logger.info(`User ${req.user!.email} clocked in`);

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
  const endingCash = cashAmount(req.body.endingCash, 'Ending cash');
  const result = await prisma.$transaction(async tx => {
    const open = await lockCurrentDrawer(tx, req, false);
    if (!open) throw new AppError('No open shift found', 404);
    const current = await tx.shift.findUniqueOrThrow({ where: { id: open.id }, include: drawerInclude });
    const summary = summarizeDrawer(current);
    const endedAt = new Date();
    const cashDifference = dollars(cents(endingCash) - cents(summary.calculatedExpected));
    const closed = await tx.shift.update({
      where: { id: current.id },
      data: { clockOutAt: endedAt, endingCash, expectedCash: summary.calculatedExpected, cashDifference, isClosed: true },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    await recordShiftWages(tx, closed);
    return { ...closed, shiftSummary: { ...summary, duration: Math.round((endedAt.getTime() - current.clockInAt.getTime()) / 36000) / 100, expectedCash: summary.calculatedExpected, endingCash, cashDifference } };
  });
  await generatePayrollExpenses().catch(error => logger.error('Payroll posting deferred', error));
  res.json({ success: true, data: result, message: 'Clocked out successfully' });
});

/**
 * Close shift
 * POST /api/shifts/:id/close
 */
export const closeShift = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const endingCash = req.body.endingCash === undefined ? null : cashAmount(req.body.endingCash, 'Ending cash');
  const result = await prisma.$transaction(async tx => {
    const exists = await tx.shift.findUnique({ where: { id } });
    if (!exists) throw new AppError('Shift not found', 404);
    assertOwnsRecord(req, exists.locationId);
    const locked = await lockDrawer(tx, id);
    if (locked.isClosed) throw new AppError('Shift already closed', 400);
    const current = await tx.shift.findUniqueOrThrow({ where: { id }, include: drawerInclude });
    const summary = summarizeDrawer(current);
    const closed = await tx.shift.update({
      where: { id },
      data: { isClosed: true, clockOutAt: new Date(), notes: req.body.notes, expectedCash: summary.calculatedExpected, endingCash, cashDifference: endingCash === null ? null : dollars(cents(endingCash) - cents(summary.calculatedExpected)) },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    await recordShiftWages(tx, closed);
    return closed;
  });
  await generatePayrollExpenses().catch(error => logger.error('Payroll posting deferred', error));
  res.json({ success: true, data: result, message: 'Shift closed successfully' });
});

/**
 * Get all shifts
 * GET /api/shifts
 */
export const getShifts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = 1, limit = 20, userId, startDate, endDate, locationId } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  const where: any = { ...getLocationFilter(req, locationId as string) };

  if (req.user?.role === 'CASHIER') where.userId = req.user.id;
  else if (userId) where.userId = userId;

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
  const shift = await prisma.$transaction(tx => tx.shift.findFirst({
    where: { userId: req.user!.id, locationId: req.user!.locationId, isClosed: false },
    include: drawerInclude, orderBy: { clockInAt: 'desc' },
  }), { isolationLevel: 'RepeatableRead' });
  if (!shift) { res.json({ success: true, data: null }); return; }
  const summary = summarizeDrawer(shift);
  res.json({ success: true, data: { ...shift, ...summary, totalCashSales: summary.cashSales, expectedDrawer: summary.calculatedExpected, drawerEntries: shift.drawerEntries.map(entry => ({ ...entry, amount: Number(entry.amount) })) } });
});

/**
 * Record a cash movement on the current open shift
 * POST /api/shifts/cash-movement
 */
export const recordCashMovement = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { type, amount, reason, idempotencyKey } = req.body;
  if (!CASH_MOVEMENT_TYPES.includes(type)) throw new AppError('Type must be one of: ' + CASH_MOVEMENT_TYPES.join(', '), 400);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw new AppError('Amount must be greater than 0', 400);
  const value = cashAmount(amount, 'Movement amount');
  if (typeof reason !== 'string' || !reason.trim()) throw new AppError('A reason is required for every cash movement', 400);
  if (idempotencyKey !== undefined && !z.string().uuid().safeParse(idempotencyKey).success) throw new AppError('A valid movement retry key is required', 400);
  const movement = await prisma.$transaction(async tx => {
    // Serialize a retry key even when it is mistakenly sent from another drawer.
    if (idempotencyKey) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'cash-movement:' + idempotencyKey}, 0))::text`;
      const prior = await tx.cashMovement.findUnique({ where: { idempotencyKey }, include: { shift: { select: { locationId: true } } } });
      if (prior) {
        if (prior.userId !== req.user!.id || prior.shift.locationId !== req.user!.locationId || prior.type !== type || Number(prior.amount) !== value || prior.reason !== reason.trim()) throw new AppError('This movement retry key belongs to a different request', 409);
        return prior;
      }
    }
    const open = await lockCurrentDrawer(tx, req, false);
    if (!open) throw new AppError('No open shift. Clock in first.', 404);
    const created = await tx.cashMovement.create({ data: { shiftId: open.id, type, amount: value, reason: reason.trim(), userId: req.user!.id, idempotencyKey: idempotencyKey || null } });
    await postDrawerEntry(tx, { sourceKey: 'movement:' + created.id, shiftId: open.id, locationId: open.locationId, userId: req.user!.id, cashMovementId: created.id, type, amount: type === 'PAID_IN' ? value : -value });
    await tx.activityLog.create({ data: { userId: req.user!.id, action: 'CASH_MOVEMENT', entity: 'SHIFT', entityId: open.id, details: { type, amount: value, reason: created.reason }, locationId: open.locationId } });
    return created;
  });
  res.status(201).json({ success: true, data: movement, message: 'Cash movement recorded' });
});

/**
 * Z-report: full end-of-shift summary for printing/records
 * GET /api/shifts/:id/z-report
 */
export const getShiftZReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const shift = await prisma.$transaction(tx => tx.shift.findUnique({
    where: { id: req.params.id },
    include: { ...drawerInclude, user: { select: { firstName: true, lastName: true } }, location: { select: { name: true } } },
  }), { isolationLevel: 'RepeatableRead' });
  if (!shift || (req.user?.role === 'CASHIER' && shift.userId !== req.user.id)) throw new AppError('Shift not found', 404);
  assertOwnsRecord(req, shift.locationId);
  res.json({ success: true, data: {
    ...summarizeDrawer(shift), shiftId: shift.id, cashier: shift.user.firstName + ' ' + shift.user.lastName,
    location: shift.location?.name || null, clockInAt: shift.clockInAt, clockOutAt: shift.clockOutAt, isClosed: shift.isClosed,
    cashMovements: shift.cashMovements, drawerEntries: shift.drawerEntries.map(entry => ({ ...entry, amount: Number(entry.amount) })),
  } });
});

/**
 * Get employee performance metrics
 * GET /api/shifts/employee-performance
 */
export const getEmployeePerformance = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, userId, locationId } = req.query;

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  const locationFilter = getLocationFilter(req, locationId as string);

  const shiftWhere: any = { ...locationFilter };
  if (dateFilter) shiftWhere.clockInAt = dateFilter;
  if (userId) shiftWhere.userId = userId;

  const saleWhere: any = { status: 'COMPLETED', ...locationFilter };
  if (dateFilter) saleWhere.createdAt = dateFilter;
  if (userId) saleWhere.userId = userId;

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
      metrics.totalCashDifference += Math.abs(Number(shift.cashDifference));
    }
  }

  // Process sales
  for (const sale of sales) {
    const userId = sale.userId;

    if (performanceMap.has(userId)) {
      const metrics = performanceMap.get(userId);
      metrics.totalSales += Number(sale.total);
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
