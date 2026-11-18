import { z } from 'zod';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { assertOwnsRecord } from '../utils/locationFilter.util';
import { recordOperation } from './operationReceipt.service';
import { cashAmount, lockCurrentDrawer, postDrawerEntry } from './drawer.service';

const schema = z.object({ idempotencyKey: z.string().uuid(), action: z.enum(['APPROVE', 'REJECT', 'REOPEN', 'PAY']),
  expectedAmount: z.number().finite().nonnegative(), expectedUpdatedAt: z.string().datetime(), reason: z.string().trim().min(1).max(500),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CHECK', 'EXTERNAL_CASH', 'DRAWER_CASH']).optional(),
  reference: z.string().trim().min(1).max(150).optional(), paidAt: z.string().datetime().optional(),
}).strict();

export async function reviewPayroll(req: AuthRequest) {
  if (req.user?.role !== 'ADMIN') throw new AppError('Payroll is owner-only', 403);
  const input = schema.parse(req.body), id = req.params.id;
  cashAmount(input.expectedAmount, 'Payroll amount');
  if (input.action === 'PAY' && (!input.paymentMethod || !input.reference || !input.paidAt)) throw new AppError('Provide payment method, reference and payment date', 400);
  if (input.paidAt && new Date(input.paidAt) > new Date()) throw new AppError('The payment date cannot be in the future', 400);
  return recordOperation(req, 'PAYROLL_' + input.action, id, input.idempotencyKey, input, async tx => {
    // Use the same drawer-before-record order as checkout and reversals.
    const drawer = input.action === 'PAY' && input.paymentMethod === 'DRAWER_CASH' ? await lockCurrentDrawer(tx, req) : null;
    await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id} FOR UPDATE`;
    const expense = await tx.expense.findUnique({ where: { id } });
    if (!expense || expense.category !== 'PAYROLL') throw new AppError('Payroll expense not found', 404);
    assertOwnsRecord(req, expense.locationId);
    if (Number(expense.amount) !== input.expectedAmount || expense.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new AppError('Payroll changed. Reload and review the current amount and status.', 409);
    const required = { APPROVE: 'PENDING', REJECT: 'PENDING', REOPEN: 'REJECTED', PAY: 'APPROVED' }[input.action];
    if (expense.status !== required) throw new AppError('This payroll state does not allow that action', 409);
    const status = { APPROVE: 'APPROVED', REJECT: 'REJECTED', REOPEN: 'PENDING', PAY: 'PAID' }[input.action] as 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
    const updated = await tx.expense.update({ where: { id }, data: { status,
      ...(input.action === 'APPROVE' ? { approvedBy: req.user!.id } : {}),
      ...(input.action === 'REOPEN' ? { approvedBy: null } : {}),
      ...(input.action === 'PAY' ? { paidDate: new Date(input.paidAt!) } : {}),
    } });
    if (drawer) await postDrawerEntry(tx, { sourceKey: 'payroll:' + id, shiftId: drawer.id, userId: req.user!.id,
      locationId: req.user!.locationId!, type: 'PAYROLL', amount: -Number(expense.amount) });
    return { id, expenseNumber: expense.expenseNumber, employeeId: expense.userId, amount: Number(expense.amount),
      previousStatus: expense.status, status: updated.status, updatedAt: updated.updatedAt, action: input.action, reason: input.reason,
      paymentMethod: input.paymentMethod || null, reference: input.reference || null, paidAt: updated.paidDate, shiftId: drawer?.id || null };
  });
}
