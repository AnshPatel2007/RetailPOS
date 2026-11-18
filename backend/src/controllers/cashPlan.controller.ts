/**
 * Money Ahead (Finances, owners only): the store's money over the next 14 days,
 * the owner's settings for it and their planned items. Routes in financial.routes.ts.
 */
import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import { forgetCashPlan, loadCashPlan } from '../services/cashPlan.service';
import { storeDay } from '../services/reorder.service';

const ownStore = (req: AuthRequest) => {
  if (!req.user?.locationId) throw new AppError('A store assignment is required', 403);
  return req.user.locationId;
};
const cents = (value: number) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
const amount = (label: string, max: number) => z.number({ invalid_type_error: `Enter ${label}` }).finite().refine(cents, 'Use whole cents').refine(value => Math.abs(value) <= max, 'That amount is too large');
const storeDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-20')
  .refine(value => { const date = new Date(value + 'T00:00:00Z'); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }, 'Choose a real date');

const settingsSchema = z.object({
  cardDepositDays: z.number().int().min(0).max(5).optional(),
  cardFeePercent: z.number().finite().min(0).max(10).refine(cents, 'Use at most two decimals').optional(),
  salesTaxFrequency: z.enum(['NONE', 'MONTHLY', 'QUARTERLY']).optional(),
  salesTaxDueDay: z.number().int().min(1).max(28).optional(),
  lotterySweepWeekday: z.number().int().min(0).max(6).nullable().optional(),
  startingMoney: amount('the money the business has', 1_000_000_000).nullable().optional(),
}).strict().refine(body => Object.keys(body).length > 0, 'Choose something to change');

const itemSchema = z.object({
  label: z.string().trim().min(1, 'Name it').max(80),
  direction: z.enum(['IN', 'OUT']),
  amount: amount('the amount', 100_000_000).refine(value => value > 0, 'Enter an amount above zero'),
  repeat: z.enum(['ONCE', 'WEEKLY', 'MONTHLY']),
  date: storeDate.nullable().optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  endsOn: storeDate.nullable().optional(),
}).strict().superRefine((item, context) => {
  if (item.repeat === 'ONCE' && !item.date) context.addIssue({ code: 'custom', path: ['date'], message: 'Choose the day' });
  if (item.repeat === 'WEEKLY' && (item.weekday === null || item.weekday === undefined)) context.addIssue({ code: 'custom', path: ['weekday'], message: 'Choose the weekday' });
  if (item.repeat === 'MONTHLY' && !item.dayOfMonth) context.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'Choose the day of the month' });
});
/** Keep only what its repeat uses. */
const itemData = (item: z.infer<typeof itemSchema>) => ({
  label: item.label, direction: item.direction, amount: item.amount, repeat: item.repeat,
  date: item.repeat === 'ONCE' ? item.date! : null, weekday: item.repeat === 'WEEKLY' ? item.weekday! : null,
  dayOfMonth: item.repeat === 'MONTHLY' ? item.dayOfMonth! : null, endsOn: item.repeat === 'ONCE' ? null : item.endsOn ?? null,
});

/** GET /api/financial/cash-plan */
export const getCashPlan = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await loadCashPlan(ownStore(req)) });
});

/** PUT /api/financial/cash-plan/settings: money today counts for the store's today. */
export const updateCashPlanSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = ownStore(req), input = settingsSchema.parse(req.body);
  const store = await prisma.location.findUniqueOrThrow({ where: { id: locationId }, select: { timezone: true } });
  const { startingMoney, ...rest } = input;
  const data = { ...rest, updatedById: req.user!.id,
    ...(startingMoney !== undefined ? { startingMoney, startingMoneyDate: startingMoney === null ? null : storeDay(store.timezone).date } : {}) };
  await prisma.cashPlanSetting.upsert({ where: { locationId }, create: { locationId, ...data }, update: data });
  forgetCashPlan(locationId);
  res.json({ success: true, data: await loadCashPlan(locationId) });
});

/** POST /api/financial/cash-plan/items */
export const createCashPlanItem = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = ownStore(req);
  if (await prisma.cashPlanItem.count({ where: { locationId, isActive: true } }) >= 100) throw new AppError('A plan holds up to 100 planned items. Remove one first.', 409);
  const item = await prisma.cashPlanItem.create({ data: { locationId, createdById: req.user!.id, ...itemData(itemSchema.parse(req.body)) } });
  forgetCashPlan(locationId);
  res.status(201).json({ success: true, data: { id: item.id } });
});

const ownItem = async (req: AuthRequest) => {
  const locationId = ownStore(req);
  const item = await prisma.cashPlanItem.findFirst({ where: { id: req.params.id, locationId, isActive: true } });
  if (!item) throw new AppError('Planned item not found', 404);
  return item;
};

/** PUT /api/financial/cash-plan/items/:id */
export const updateCashPlanItem = asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await ownItem(req);
  await prisma.cashPlanItem.update({ where: { id: item.id }, data: itemData(itemSchema.parse(req.body)) });
  forgetCashPlan(item.locationId);
  res.json({ success: true, data: { id: item.id } });
});

/** DELETE /api/financial/cash-plan/items/:id */
export const deleteCashPlanItem = asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await ownItem(req);
  await prisma.cashPlanItem.delete({ where: { id: item.id } });
  forgetCashPlan(item.locationId);
  res.json({ success: true, data: { id: item.id } });
});
