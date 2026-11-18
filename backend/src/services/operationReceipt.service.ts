import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { numeric } from '../utils/money';
import { requestHash } from './managerApproval.service';

/** Business changes and their exact replay result share one database commit. */
export async function recordOperation(req: AuthRequest, kind: string, targetId: string, key: string,
  input: unknown, change: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  if (!req.user?.locationId || req.user.role === 'SUPER_ADMIN') throw new AppError('An operational store assignment is required', 403);
  const actor = req.user;
  const hash = requestHash('OPERATION', kind, { targetId, input, userId: actor.id, locationId: actor.locationId });
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
    const previous = await tx.operationReceipt.findUnique({ where: { idempotencyKey: key } });
    if (previous) {
      if (previous.userId !== actor.id || previous.locationId !== actor.locationId || previous.kind !== kind || previous.targetId !== targetId || previous.requestHash !== hash) throw new AppError('This retry key belongs to a different operation', 409);
      return { receiptId: previous.id, data: previous.result, replayed: true };
    }
    const result = JSON.parse(JSON.stringify(numeric(await change(tx)))) as Prisma.InputJsonValue;
    const receipt = await tx.operationReceipt.create({ data: { idempotencyKey: key, kind, targetId, userId: actor.id, locationId: actor.locationId!, requestHash: hash, result } });
    await tx.activityLog.create({ data: { userId: actor.id, locationId: actor.locationId, action: kind, entity: 'OperationReceipt', entityId: receipt.id, details: { targetId, receiptId: receipt.id } } });
    return { receiptId: receipt.id, data: result, replayed: false };
  }, { timeout: 30000 });
}
