import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { assertOwnsRecord } from '../utils/locationFilter.util';
import { generatePayrollExpenses } from '../services/payroll.service';
import { reviewPayroll } from '../services/payrollReview.service';

const storeId = (req: AuthRequest) => {
  const id = req.user?.role === 'SUPER_ADMIN' ? req.query.locationId as string || req.user.locationId : req.user?.locationId;
  if (!id) throw new AppError('Choose a store',400);
  return id;
};
export const getPayroll = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = storeId(req);
  const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page || 1);
  const limit = 50;
  const [location, staff, entries, unratedShifts, runs, runCount] = await Promise.all([
    prisma.location.findUnique({ where: { id: locationId }, select: { id: true, name: true, payrollFrequency: true, timezone: true } }),
    // Home staff, plus anyone from another store who worked a shift here.
    prisma.user.findMany({ where: { OR: [{ locationId }, { shifts: { some: { locationId } } }] }, select: { id: true, firstName: true, lastName: true, email: true, hourlyRate: true, isActive: true } }),
    prisma.payrollEntry.findMany({ where: { locationId, expenseId: null }, include: { user: { select: { firstName: true, lastName: true } }, expense: { select: { id: true, expenseNumber: true, status: true } } }, orderBy: [{ periodStart: 'desc' }, { id: 'desc' }], take: 50 }),
    prisma.shift.count({ where: { locationId, hourlyRate: null, clockOutAt: { not: null } } }),
    prisma.expense.findMany({ where: { locationId, category: 'PAYROLL' }, include: { user: { select: { firstName: true, lastName: true } }, _count: { select: { payrollEntries: true } } }, orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.expense.count({ where: { locationId, category: 'PAYROLL' } }),
  ]);
  res.json({ success: true, data: { location, staff, entries, unratedShifts, runs, pagination: { page, limit, total: runCount, totalPages: Math.ceil(runCount / limit) } } });
});
export const reviewPayrollExpense = asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, ...await reviewPayroll(req) }));
export const getPayrollExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
  const expense = await prisma.expense.findUnique({ where: { id: req.params.id }, include: { user: { select: { firstName: true, lastName: true } } } });
  if (!expense || expense.category !== 'PAYROLL') throw new AppError('Payroll expense not found', 404);
  assertOwnsRecord(req, expense.locationId);
  const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page || 1);
  const [entries, total, history] = await Promise.all([
    prisma.payrollEntry.findMany({ where: { expenseId: expense.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * 50, take: 50,
      include: { shift: { select: { clockInAt: true, clockOutAt: true } } } }),
    prisma.payrollEntry.count({ where: { expenseId: expense.id } }),
    prisma.operationReceipt.findMany({ where: { locationId: expense.locationId!, targetId: expense.id, kind: { startsWith: 'PAYROLL_' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
      select: { id: true, kind: true, createdAt: true, result: true, user: { select: { firstName: true, lastName: true } } } }),
  ]);
  res.json({ success: true, data: { expense, entries, history, pagination: { page, limit: 50, total, totalPages: Math.ceil(total / 50) } } });
});
export const setHourlyRate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { hourlyRate } = z.object({ hourlyRate: z.number().finite().min(0).max(10000).nullable() }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new AppError('Employee not found',404);
  assertOwnsRecord(req,user.locationId);
  if (!user.locationId) throw new AppError('Assign the employee to a store first',400);
  if (req.user!.role !== 'SUPER_ADMIN' && user.role === 'SUPER_ADMIN') throw new AppError('Access denied',403);
  const rate = hourlyRate === null ? null : Math.round(hourlyRate*100)/100;
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: user.id }, data: { hourlyRate: rate } });
    await tx.activityLog.create({ data: { userId: req.user!.id, action: 'HOURLY_RATE_UPDATED', entity: 'User', entityId: user.id, locationId: user.locationId, details: { previous: user.hourlyRate, hourlyRate: rate } } });
  });
  res.json({ success: true, message: 'Rate saved. It applies to future clock-ins.' });
});
export const setPayrollSchedule = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { frequency } = z.object({ frequency: z.enum(['WEEKLY','MONTHLY']) }).parse(req.body);
  const locationId = storeId(req);
  await prisma.location.update({ where: { id: locationId }, data: { payrollFrequency: frequency } });
  res.json({ success: true, message: 'Schedule saved for future clock-ins' });
});
export const processPayroll = asyncHandler(async (req: AuthRequest, res: Response) => {
  await generatePayrollExpenses(new Date(), storeId(req));
  res.json({ success: true, message: 'Completed pay periods posted to Expenses' });
});
