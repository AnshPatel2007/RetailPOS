import { User } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';

export async function createLoginSession(verified: User, token: string, deviceInfo: string, ipAddress?: string) {
  return prisma.$transaction(async tx => {
    // A password/authority change must not race a login using old credentials.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${verified.id} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: verified.id } });
    if (!current?.isActive || current.password !== verified.password || current.role !== verified.role || current.locationId !== verified.locationId || current.twoFactorEnabled !== verified.twoFactorEnabled || current.twoFactorSecret !== verified.twoFactorSecret || current.twoFactorVersion !== verified.twoFactorVersion) {
      throw new AppError('Account access changed. Sign in again.', 401);
    }
    if (current.role !== 'SUPER_ADMIN' && !current.locationId) throw new AppError('A store assignment is required', 403);
    return tx.refreshToken.create({ data: { token, userId: current.id, deviceInfo, ipAddress, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
  });
}
