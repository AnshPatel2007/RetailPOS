import { Response } from 'express';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { config } from '../config';
import { consumeSecondFactor } from '../services/twoFactor.service';
import {queueSecurityEmail} from '../services/securityEmail.service';
export { verifyTOTPCode } from '../services/twoFactor.service';

const passwordInput = z.object({ password: z.string().min(1).max(200) });
const proofInput = passwordInput.extend({ code: z.string().trim().min(6).max(64) });
const codes = () => Array.from({ length: 10 }, () => randomBytes(8).toString('hex').toUpperCase());
async function lockedUser(tx: Prisma.TransactionClient, req: AuthRequest) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user!.id} FOR UPDATE`;
  const user = await tx.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const session = await tx.refreshToken.findFirst({ where: { id: req.sessionId, userId: user.id, isRevoked: false, expiresAt: { gt: new Date() } } });
  if (!user.isActive || !session) throw new AppError('Session expired. Sign in again.', 401);
  return user;
}
async function keepCurrentSession(tx: Prisma.TransactionClient, req: AuthRequest) {
  await tx.$queryRaw`SELECT set_config('pos.keep_session_id', ${req.sessionId!}, true)`;
}
const audit = async(tx: Prisma.TransactionClient, req: AuthRequest, action: string) => {
  await tx.activityLog.create({data:{userId:req.user!.id,locationId:req.user!.locationId,action,entity:'USER',entityId:req.user!.id}});
  if(['2FA_ENABLED','2FA_DISABLED','2FA_BACKUP_CODES_REGENERATED'].includes(action)){
    const user=await tx.user.findUniqueOrThrow({where:{id:req.user!.id}});
    await queueSecurityEmail(tx,user,action,String(user.twoFactorVersion));
  }
};

export const setup2FA = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { password } = passwordInput.parse(req.body);
  const secret = authenticator.generateSecret();
  const user = await prisma.$transaction(async tx => {
    const current = await lockedUser(tx, req);
    if (!await bcrypt.compare(password, current.password)) throw new AppError('Verification failed', 403);
    if (current.twoFactorEnabled) throw new AppError('Two-factor authentication is already enabled', 409);
    await tx.user.update({ where: { id: current.id }, data: { twoFactorSetupSecret: secret, twoFactorSetupExpires: new Date(Date.now() + 10 * 60000) } });
    await audit(tx, req, '2FA_SETUP_STARTED'); return current;
  });
  const otpauthUrl = authenticator.keyuri(user.email, config.security.twoFactorIssuer, secret);
  res.json({ success: true, data: { secret, qrCode: await QRCode.toDataURL(otpauthUrl), otpauthUrl, expiresIn: 600 } });
});

export const cancel2FASetup = asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.$transaction(async tx => {
    await lockedUser(tx, req);
    await tx.user.update({ where: { id: req.user!.id }, data: { twoFactorSetupSecret: null, twoFactorSetupExpires: null } });
    await audit(tx, req, '2FA_SETUP_CANCELLED');
  });
  res.json({ success: true });
});

export const verify2FA = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  const backupCodes = codes();
  const hashes = await Promise.all(backupCodes.map(code => bcrypt.hash(code, 10)));
  await prisma.$transaction(async tx => {
    const user = await lockedUser(tx, req);
    if (user.twoFactorEnabled) throw new AppError('Two-factor authentication is already enabled', 409);
    if (!user.twoFactorSetupSecret || !user.twoFactorSetupExpires || user.twoFactorSetupExpires <= new Date()) throw new AppError('Setup expired. Start setup again.', 409);
    const delta = authenticator.clone({ window: 1 }).checkDelta(code, user.twoFactorSetupSecret);
    if (delta === null) throw new AppError('Invalid verification code', 400);
    await keepCurrentSession(tx, req);
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true, twoFactorSecret: user.twoFactorSetupSecret,
      twoFactorSetupSecret: null, twoFactorSetupExpires: null, twoFactorBackupCodes: hashes,
      twoFactorLastStep: Math.floor(Date.now() / 30000) + delta, twoFactorVersion: { increment: 1 } } });
    await audit(tx, req, '2FA_ENABLED');
  }, { timeout: 15000 });
  res.json({ success: true, data: { backupCodes }, message: 'Two-factor authentication enabled. Other sessions have been signed out.' });
});

export const disable2FA = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { password, code } = proofInput.parse(req.body);
  await prisma.$transaction(async tx => {
    const user = await lockedUser(tx, req);
    if (!await bcrypt.compare(password, user.password) || !await consumeSecondFactor(tx, user.id, code)) throw new AppError('A valid password and unused authentication or backup code are required', 403);
    await keepCurrentSession(tx, req);
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorSetupSecret: null,
      twoFactorSetupExpires: null, twoFactorLastStep: null, twoFactorBackupCodes: [], twoFactorVersion: { increment: 1 } } });
    await audit(tx, req, '2FA_DISABLED');
  }, { timeout: 15000 });
  res.json({ success: true, message: 'Two-factor authentication disabled. Other sessions have been signed out.' });
});

export const regenerateBackupCodes = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { password, code } = proofInput.parse(req.body);
  const backupCodes = codes(), hashes = await Promise.all(backupCodes.map(code => bcrypt.hash(code, 10)));
  await prisma.$transaction(async tx => {
    const user = await lockedUser(tx, req);
    if (!await bcrypt.compare(password, user.password) || !await consumeSecondFactor(tx, user.id, code)) throw new AppError('A valid password and unused authentication or backup code are required', 403);
    await keepCurrentSession(tx, req);
    await tx.user.update({ where: { id: user.id }, data: { twoFactorBackupCodes: hashes, twoFactorVersion: { increment: 1 } } });
    await audit(tx, req, '2FA_BACKUP_CODES_REGENERATED');
  }, { timeout: 15000 });
  res.json({ success: true, data: { backupCodes }, message: 'Backup codes replaced. Other sessions have been signed out.' });
});

export const get2FAStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { twoFactorEnabled: true, twoFactorBackupCodes: true } });
  res.json({ success: true, data: { enabled: user.twoFactorEnabled, backupCodesRemaining: user.twoFactorBackupCodes.length } });
});
