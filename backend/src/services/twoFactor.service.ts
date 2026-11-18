import { Prisma } from '@prisma/client';
import { authenticator } from 'otplib';
import bcrypt from 'bcryptjs';
import prisma from '../config/database';

/** The user lock serializes recovery-code consumption and authenticator replay. */
export async function consumeSecondFactor(tx: Prisma.TransactionClient, userId: string, code: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user?.isActive || !user.twoFactorEnabled || !user.twoFactorSecret || typeof code !== 'string' || code.length > 64) return false;
  const token = code.trim().toUpperCase();
  if (/^\d{6}$/.test(token)) {
    const delta = authenticator.clone({ window: 1 }).checkDelta(token, user.twoFactorSecret);
    if (delta !== null) {
      const step = Math.floor(Date.now() / 30000) + delta;
      if (user.twoFactorLastStep !== null && step <= user.twoFactorLastStep) return false;
      await tx.user.update({ where: { id: userId }, data: { twoFactorLastStep: step } });
      return true;
    }
  }
  for (const hash of user.twoFactorBackupCodes) {
    if (await bcrypt.compare(token, hash)) {
      await tx.user.update({ where: { id: userId }, data: { twoFactorBackupCodes: user.twoFactorBackupCodes.filter(value => value !== hash) } });
      await tx.activityLog.create({ data: { userId, locationId: user.locationId, action: '2FA_RECOVERY_USED', entity: 'USER', entityId: userId } });
      return true;
    }
  }
  return false;
}

export const verifyTOTPCode = (userId: string, code: string) => prisma.$transaction(tx => consumeSecondFactor(tx, userId, code));
