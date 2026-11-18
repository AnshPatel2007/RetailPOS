import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { nextDocumentNumber } from './documentNumber.service';

const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const wallParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, Number(x.value)]));
  return p;
};
const midnightInZone = (calendar: Date, timezone: string) => {
  const target = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), calendar.getUTCDate());
  let guess = target;
  for (let i = 0; i < 5; i++) {
    const p = wallParts(new Date(guess),timezone);
    const local = Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    const correction = target-local;
    guess += correction;
    if (!correction) break;
  }
  return new Date(guess);
};
export function payrollPeriod(at: Date, frequency: string, timezone: string) {
  const p = wallParts(at,timezone);
  const start = new Date(Date.UTC(p.year,p.month-1,p.day));
  if (frequency === 'MONTHLY') start.setUTCDate(1);
  else start.setUTCDate(start.getUTCDate() - (start.getUTCDay()+6)%7);
  const end = new Date(start);
  if (frequency === 'MONTHLY') end.setUTCMonth(end.getUTCMonth()+1);
  else end.setUTCDate(end.getUTCDate()+7);
  return { start: midnightInZone(start,timezone), end: midnightInZone(end,timezone) };
}
export function shiftWageSegments(shift: { clockInAt: Date; clockOutAt: Date | null; hourlyRate: number | Prisma.Decimal | null; payrollFrequency: string | null; payrollTimezone: string | null }) {
  if (!shift.clockOutAt || shift.hourlyRate === null) return [];
  const rows: { periodStart: Date; periodEnd: Date; seconds: number; hourlyRate: number; grossPay: number }[] = [];
  let cursor = new Date(shift.clockInAt);
  while (cursor < shift.clockOutAt) {
    const { start, end } = payrollPeriod(cursor,shift.payrollFrequency || 'WEEKLY',shift.payrollTimezone || 'UTC');
    const until = new Date(Math.min(end.getTime(),shift.clockOutAt.getTime()));
    const seconds = Math.max(0, Math.round((until.getTime()-cursor.getTime())/1000));
    if (seconds) rows.push({ periodStart: start, periodEnd: end, seconds, hourlyRate: Number(shift.hourlyRate), grossPay: roundMoney(seconds/3600*Number(shift.hourlyRate)) });
    cursor = until;
  }
  return rows;
}
export async function recordShiftWages(tx: Prisma.TransactionClient, shift: any) {
  if (!shift.locationId) return;
  for (const row of shiftWageSegments(shift)) {
    await tx.payrollEntry.upsert({ where: { shiftId_periodStart: { shiftId: shift.id, periodStart: row.periodStart } }, create: { ...row, shiftId: shift.id, userId: shift.userId, locationId: shift.locationId }, update: {} });
  }
}
export async function generatePayrollExpenses(now = new Date(), locationId?: string) {
  return prisma.$transaction(async tx => {
    // Serialize scheduler/manual runs across server processes.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(28481762)::text`;
    const due = await tx.payrollEntry.findMany({ where: { periodEnd: { lte: now }, expenseId: null, ...(locationId ? { locationId } : {}) }, include: { user: { select: { firstName: true, lastName: true } } }, orderBy: { id: 'asc' } });
    const groups = new Map<string, typeof due>();
    for (const row of due) {
      const key = [row.userId,row.locationId,row.periodStart.toISOString(),row.periodEnd.toISOString()].join(':');
      groups.set(key,[...(groups.get(key) || []),row]);
    }
    let created = 0;
    for (const rows of groups.values()) {
      const first = rows[0];
      const baseNumber = 'PAY-' + first.userId + '-' + first.locationId + '-' + first.periodStart.getTime() + '-' + first.periodEnd.getTime();
      await tx.$queryRaw`SELECT id FROM expenses WHERE "expenseNumber" = ${baseNumber} OR "referenceKey" = ${baseNumber} FOR UPDATE`;
      const previous = await tx.expense.findFirst({ where: { OR: [{ referenceKey: baseNumber }, { expenseNumber: baseNumber }] } });
      const amount = roundMoney(rows.reduce((sum,r) => sum+Number(r.grossPay),0));
      if (amount <= 0) continue;
      const description = 'Gross wages: ' + first.user.firstName + ' ' + first.user.lastName + ' | ' + first.periodStart.toISOString() + ' to ' + first.periodEnd.toISOString();
      const expense = previous && previous.status !== 'PAID' && previous.status !== 'REJECTED'
        ? await tx.expense.update({ where: { id: previous.id }, data: { amount: roundMoney(Number(previous.amount)+amount), status: 'PENDING', approvedBy: null } })
        : await tx.expense.create({ data: { expenseNumber: await nextDocumentNumber('EXP', tx), referenceKey: previous ? baseNumber + '-' + first.id : baseNumber, category: 'PAYROLL', description, amount, locationId: first.locationId, userId: first.userId, expenseDate: new Date(first.periodEnd.getTime()-1), dueDate: first.periodEnd, status: 'PENDING' } });
      await tx.payrollEntry.updateMany({ where: { id: { in: rows.map(r => r.id) }, expenseId: null }, data: { expenseId: expense.id } });
      created++;
    }
    return created;
  }, { timeout: 30000 });
}
export function startPayrollScheduler() {
  if (process.env.PAYROLL_SCHEDULER_DISABLED === 'true') return;
  const run = () => generatePayrollExpenses().catch(error => logger.error('Payroll expense generation failed', error));
  void run();
  setInterval(run,60*1000).unref();
}
