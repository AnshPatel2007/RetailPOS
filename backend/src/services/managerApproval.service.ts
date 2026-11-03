import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { can, Capability } from '../policies/capabilities';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const approvalToken = () => randomBytes(32).toString('hex');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const requestHash = (method: string, route: string, body: unknown) => hashToken(JSON.stringify(canonical({ method: method.toUpperCase(), route, body })));

export function approvalAction(route: string, method: string): Capability {
  if (method.toUpperCase() !== 'POST') throw new AppError('This action does not support manager approval', 400);
  if (/^\/api\/sales\/?$/.test(route)) return 'checkout.override';
  if (/^\/api\/sales\/[^/]+\/(refund|void)$/.test(route)) return 'sale.reverse';
  throw new AppError('This action does not support manager approval', 400);
}

/** Consume with the business mutation, so a failed transaction preserves approval. */
export async function requireTransactionApproval(req: AuthRequest, tx: Prisma.TransactionClient, capability: Capability) {
  if (can(req.user?.role, capability)) return;
  if (req.user?.role !== 'CASHIER') throw new AppError('Insufficient permissions', 403);
  const token = req.headers['x-manager-approval'];
  if (typeof token !== 'string') throw new AppError('Manager approval is required for this exact action', 428);
  const tokenHash = hashToken(token);
  await tx.$queryRaw`SELECT id FROM manager_approvals WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
  const approval = await tx.managerApproval.findUnique({ where: { tokenHash } });
  const route = req.originalUrl.split('?')[0];
  if (!approval || approval.consumedAt || approval.expiresAt <= new Date() || approval.cashierId !== req.user.id || approval.locationId !== req.user.locationId || approval.action !== capability || approval.requestHash !== requestHash(req.method, route, req.body)) {
    throw new AppError('Approval expired, was already used, or does not match this action. Request approval again.', 428);
  }
  const manager = await tx.user.findUnique({ where: { id: approval.managerId }, select: { role: true, locationId: true, isActive: true } });
  if (!manager?.isActive || manager.locationId !== req.user.locationId || !can(manager.role, capability)) throw new AppError('The approving manager no longer has permission', 403);
  await tx.managerApproval.update({ where: { id: approval.id }, data: { consumedAt: new Date() } });
  await tx.activityLog.create({ data: { userId: req.user.id, locationId: req.user.locationId, action: 'MANAGER_APPROVAL_USED', entity: 'ManagerApproval', entityId: approval.id, details: { managerId: approval.managerId, cashierId: req.user.id, action: capability, route, reason: approval.reason } } });
  return { id: approval.id, managerId: approval.managerId };
}
