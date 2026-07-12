import { Response } from 'express';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Cryptographically random 8-char alphanumeric backup code
 * (replaces the ESM-only crypto-random-string dependency)
 */
const generateBackupCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
};
import { send2FAEnabledEmail } from '../utils/email';

/**
 * Generate 2FA secret and QR code
 * POST /api/auth/2fa/setup
 */
export const setup2FA = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      twoFactorEnabled: true,
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.twoFactorEnabled) {
    throw new AppError('Two-factor authentication is already enabled', 400);
  }

  // Generate secret
  const secret = authenticator.generateSecret();

  // Create otpauth URL for QR code
  const otpauthUrl = authenticator.keyuri(
    user.email,
    config.security.twoFactorIssuer,
    secret
  );

  // Generate QR code as data URL
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  // Store secret temporarily (not enabled yet)
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorSecret: secret },
  });

  logger.info(`2FA setup initiated for user: ${user.email}`);

  res.json({
    success: true,
    data: {
      secret,
      qrCode: qrCodeDataUrl,
      otpauthUrl,
    },
    message: 'Scan the QR code with your authenticator app, then verify with a code',
  });
});

/**
 * Verify and enable 2FA
 * POST /api/auth/2fa/verify
 */
export const verify2FA = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { code } = req.body;

  if (!code) {
    throw new AppError('Verification code is required', 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.twoFactorEnabled) {
    throw new AppError('Two-factor authentication is already enabled', 400);
  }

  if (!user.twoFactorSecret) {
    throw new AppError('Please set up 2FA first', 400);
  }

  // Verify the code
  const isValid = authenticator.verify({
    token: code,
    secret: user.twoFactorSecret,
  });

  if (!isValid) {
    throw new AppError('Invalid verification code', 400);
  }

  // Generate backup codes
  const backupCodes = Array.from({ length: 10 }, () => generateBackupCode());

  // Hash backup codes for storage
  const hashedBackupCodes = await Promise.all(
    backupCodes.map(code => bcrypt.hash(code, 10))
  );

  // Enable 2FA
  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorEnabled: true,
      twoFactorBackupCodes: hashedBackupCodes,
    },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: '2FA_ENABLED',
      entity: 'USER',
      entityId: user.id,
    },
  });

  // Send notification email
  try {
    await send2FAEnabledEmail(user.email, user.firstName);
  } catch (error) {
    logger.error('Failed to send 2FA enabled email:', error);
  }

  logger.info(`2FA enabled for user: ${user.email}`);

  res.json({
    success: true,
    data: {
      backupCodes,
    },
    message: 'Two-factor authentication enabled successfully. Save your backup codes!',
  });
});

/**
 * Disable 2FA
 * POST /api/auth/2fa/disable
 */
export const disable2FA = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { password, code } = req.body;

  if (!password) {
    throw new AppError('Password is required', 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (!user.twoFactorEnabled) {
    throw new AppError('Two-factor authentication is not enabled', 400);
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new AppError('Invalid password', 401);
  }

  // Verify 2FA code if provided
  if (code && user.twoFactorSecret) {
    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret,
    });

    if (!isValid) {
      throw new AppError('Invalid verification code', 400);
    }
  }

  // Disable 2FA
  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: [],
    },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: '2FA_DISABLED',
      entity: 'USER',
      entityId: user.id,
    },
  });

  logger.info(`2FA disabled for user: ${user.email}`);

  res.json({
    success: true,
    message: 'Two-factor authentication disabled successfully',
  });
});

/**
 * Get 2FA status
 * GET /api/auth/2fa/status
 */
export const get2FAStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      twoFactorEnabled: true,
      twoFactorBackupCodes: true,
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    data: {
      enabled: user.twoFactorEnabled,
      backupCodesRemaining: user.twoFactorBackupCodes.length,
    },
  });
});

/**
 * Regenerate backup codes
 * POST /api/auth/2fa/backup-codes
 */
export const regenerateBackupCodes = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { password } = req.body;

  if (!password) {
    throw new AppError('Password is required', 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (!user.twoFactorEnabled) {
    throw new AppError('Two-factor authentication is not enabled', 400);
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new AppError('Invalid password', 401);
  }

  // Generate new backup codes
  const backupCodes = Array.from({ length: 10 }, () => generateBackupCode());

  // Hash backup codes for storage
  const hashedBackupCodes = await Promise.all(
    backupCodes.map(code => bcrypt.hash(code, 10))
  );

  // Update backup codes
  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorBackupCodes: hashedBackupCodes,
    },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: '2FA_BACKUP_CODES_REGENERATED',
      entity: 'USER',
      entityId: user.id,
    },
  });

  logger.info(`Backup codes regenerated for user: ${user.email}`);

  res.json({
    success: true,
    data: {
      backupCodes,
    },
    message: 'Backup codes regenerated successfully. Save them securely!',
  });
});

/**
 * Verify 2FA code during login (called internally)
 */
export const verifyTOTPCode = async (
  userId: string,
  code: string
): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      twoFactorSecret: true,
      twoFactorBackupCodes: true,
    },
  });

  if (!user || !user.twoFactorSecret) {
    return false;
  }

  // Try TOTP code first
  const isValidTOTP = authenticator.verify({
    token: code,
    secret: user.twoFactorSecret,
  });

  if (isValidTOTP) {
    return true;
  }

  // Try backup codes
  for (let i = 0; i < user.twoFactorBackupCodes.length; i++) {
    const isValidBackup = await bcrypt.compare(code, user.twoFactorBackupCodes[i]);
    if (isValidBackup) {
      // Remove used backup code
      const updatedCodes = [...user.twoFactorBackupCodes];
      updatedCodes.splice(i, 1);

      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorBackupCodes: updatedCodes,
        },
      });

      logger.info(`Backup code used for user: ${userId}`);
      return true;
    }
  }

  return false;
};
