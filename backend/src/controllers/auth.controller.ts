import { Request, Response } from 'express';
import type { Location, Prisma, User } from '@prisma/client';
import { resolveUserAssignment } from '../utils/userPermissions';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { generateToken, generateRefreshToken, verifyToken } from '../utils/jwt';
import { createLoginSession } from '../services/session.service';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { config } from '../config';
import { logger } from '../utils/logger';
import { verifyTOTPCode } from './twoFactor.controller';
import {queueSecurityEmail} from '../services/securityEmail.service';

const refreshCookieOptions = {
  httpOnly: true, secure: config.nodeEnv === 'production',
  sameSite: (config.nodeEnv === 'production' ? 'none' : 'lax') as 'none' | 'lax', path: '/',
};

/**
 * Check and handle account lockout
 */
const checkAccountLockout = async (user: any): Promise<void> => {
  if (user.lockoutUntil && user.lockoutUntil > new Date()) {
    const remainingMinutes = Math.ceil(
      (user.lockoutUntil.getTime() - Date.now()) / 60000
    );
    throw new AppError(
      `Account is temporarily locked. Try again in ${remainingMinutes} minutes.`,
      423
    );
  }

  // Clear lockout if expired
  if (user.lockoutUntil && user.lockoutUntil <= new Date()) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockoutUntil: null,
      },
    });
  }
};

/**
 * Handle failed login attempt
 */
const handleFailedLogin = async(user:any):Promise<void>=>{
  const locked=await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id} FOR UPDATE`;
    const current=await tx.user.findUnique({where:{id:user.id}});
    if(!current)return false;
    if(current.lockoutUntil && current.lockoutUntil>new Date())return true;
    const attempts=(current.failedLoginAttempts||0)+1,locked=attempts>=config.security.maxLoginAttempts;
    const until=locked?new Date(Date.now()+config.security.lockoutDuration*60000):null;
    await tx.user.update({where:{id:user.id},data:{failedLoginAttempts:attempts,lockoutUntil:until}});
    if(locked)await queueSecurityEmail(tx,current,'ACCOUNT_LOCKED',until!.toISOString());
    return locked;
  });
  if(locked)throw new AppError('Account locked due to too many failed attempts. Try again in '+config.security.lockoutDuration+' minutes.',423);
};

/**
 * User login
 * POST /api/auth/login
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, twoFactorCode } = req.body;

  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
    include: { location: true },
  });

  if (!user || !user.isActive) {
    throw new AppError('Invalid credentials', 401);
  }

  // Check account lockout
  await checkAccountLockout(user);

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    await handleFailedLogin(user);
    throw new AppError('Invalid credentials', 401);
  }

  // Check if 2FA is enabled
  if (user.twoFactorEnabled) {
    if (!twoFactorCode) {
      // Return special response indicating 2FA is required
      res.json({
        success: true,
        requiresTwoFactor: true,
        message: 'Two-factor authentication code required',
      });
      return;
    }

    // Verify 2FA code
    const is2FAValid = await verifyTOTPCode(user.id, twoFactorCode);
    if (!is2FAValid) {
      await handleFailedLogin(user);
      throw new AppError('Invalid two-factor authentication code', 401);
    }
  }

  // Reset failed login attempts on successful login
  if (user.failedLoginAttempts > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockoutUntil: null,
      },
    });
  }

  await completeSignIn(req, res, user);
});

/**
 * Start a session for a verified user: refresh cookie, access token, last login and
 * the LOGIN activity entry. Shared by password and register PIN sign-in.
 */
export const completeSignIn = async (req: Request, res: Response, user: User & { location: Location | null }, details?: Prisma.InputJsonValue) => {
  const refreshToken = generateRefreshToken();
  const session = await createLoginSession(user, refreshToken, req.headers['user-agent'] || 'Unknown', req.ip);
  const token = generateToken({
    sessionId: session.id,
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: 'LOGIN',
      entity: 'USER',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      locationId: user.locationId,
      ...(details !== undefined ? { details } : {}),
    },
  });

  logger.info(`User logged in: ${user.email}`);

  // Set refresh token as httpOnly cookie
  res.cookie('refreshToken', refreshToken, {
    ...refreshCookieOptions,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        locationId: user.locationId,
        location: user.location,
        twoFactorEnabled: user.twoFactorEnabled,
        hasPin: !!user.pinHash,
      },
    },
  });
};

/**
 * Refresh access token
 * POST /api/auth/refresh
 */
export const refreshAccessToken = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    throw new AppError('Refresh token not provided', 401);
  }

  // Find the refresh token
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });

  if (!storedToken || storedToken.isRevoked) {
    throw new AppError('Invalid refresh token', 401);
  }

  if (storedToken.expiresAt < new Date()) {
    // Clean up expired token
    await prisma.refreshToken.delete({
      where: { id: storedToken.id },
    });
    throw new AppError('Refresh token expired', 401);
  }

  if (!storedToken.user.isActive) {
    throw new AppError('User account is disabled', 401);
  }

  // Generate new access token
  const token = generateToken({
    sessionId: storedToken.id,
    userId: storedToken.user.id,
    email: storedToken.user.email,
    role: storedToken.user.role,
  });

  // Update last used
  const renewed = await prisma.refreshToken.updateMany({
    where: { id: storedToken.id, isRevoked: false, expiresAt: { gt: new Date() } },
    data: { lastUsedAt: new Date() },
  });
  if (!renewed.count) throw new AppError('Session expired or revoked', 401);

  res.json({
    success: true,
    data: { token },
  });
});

/**
 * Get current user
 * GET /api/auth/me
 */
export const getCurrentUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      locationId: true,
      twoFactorEnabled: true,
      pinHash: true,
      location: {
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          state: true,
          timezone: true,
        },
      },
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Only whether a register PIN is set ever leaves the server, never its hash.
  const { pinHash, ...profile } = user;
  res.json({
    success: true,
    data: { ...profile, hasPin: !!pinHash },
  });
});

/**
 * Register new user (Admin only)
 * POST /api/auth/register
 */
export const register = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email, password, firstName, lastName, role, locationId } = req.body;

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new AppError('User with this email already exists', 400);
  }

  // Password strength validation
  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 400);
  }

  if (!/[A-Z]/.test(password)) {
    throw new AppError('Password must contain at least one uppercase letter', 400);
  }

  if (!/[a-z]/.test(password)) {
    throw new AppError('Password must contain at least one lowercase letter', 400);
  }

  if (!/[0-9]/.test(password)) {
    throw new AppError('Password must contain at least one number', 400);
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    throw new AppError('Password must contain at least one special character', 400);
  }

  const assignment = resolveUserAssignment(req, role, locationId);

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      firstName,
      lastName,
      ...assignment,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      createdAt: true,
    },
  });

  logger.info(`New user registered: ${user.email}`);

  res.status(201).json({
    success: true,
    data: user,
    message: 'User registered successfully',
  });
});

/**
 * Logout user
 * POST /api/auth/logout
 */
export const logout = asyncHandler(async (req: AuthRequest, res: Response) => {
  // An expired access token must not prevent revoking its refresh cookie.
  let sessionId: string | undefined;
  let userId: string | undefined;
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  if (bearer) { try { const decoded = verifyToken(bearer); sessionId = decoded.sessionId; userId = decoded.userId; } catch { /* Fall back to the HttpOnly cookie. */ } }
  const cookie = req.cookies.refreshToken;
  const session = sessionId ? await prisma.refreshToken.findUnique({ where: { id: sessionId }, include: { user: true } })
    : typeof cookie === 'string' ? await prisma.refreshToken.findUnique({ where: { token: cookie }, include: { user: true } }) : null;
  if (!session || (sessionId && session.userId !== userId)) { res.clearCookie('refreshToken', refreshCookieOptions); throw new AppError('No valid session provided', 401); }
  await prisma.$transaction(async tx => {
    const revoked = await tx.refreshToken.updateMany({ where: { id: session.id, isRevoked: false }, data: { isRevoked: true } });
    if (revoked.count) {
    await tx.activityLog.create({
      data: {
        userId: session.userId,
        action: 'LOGOUT',
        entity: 'USER',
        entityId: session.userId,
        locationId: session.user.locationId,
      },
    });
    }
  });

  // Clear refresh token cookie
  res.clearCookie('refreshToken', refreshCookieOptions);

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

/**
 * Logout from all devices
 * POST /api/auth/logout-all
 */
export const logoutAll = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  // Revoke all refresh tokens for this user
  await prisma.refreshToken.updateMany({
    where: { userId: req.user.id },
    data: { isRevoked: true },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'LOGOUT_ALL_DEVICES',
      entity: 'USER',
      entityId: req.user.id,
      locationId: req.user.locationId,
    },
  });

  // Clear refresh token cookie
  res.clearCookie('refreshToken', refreshCookieOptions);

  logger.info(`User logged out from all devices: ${req.user.email}`);

  res.json({
    success: true,
    message: 'Logged out from all devices successfully',
  });
});

/**
 * Get active sessions
 * GET /api/auth/sessions
 */
export const getSessions = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const sessions = await prisma.refreshToken.findMany({
    where: {
      userId: req.user.id,
      isRevoked: false,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      deviceInfo: true,
      ipAddress: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { lastUsedAt: 'desc' },
  });

  res.json({
    success: true,
    data: sessions,
  });
});

/**
 * Revoke specific session
 * DELETE /api/auth/sessions/:sessionId
 */
export const revokeSession = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { sessionId } = req.params;

  const session = await prisma.refreshToken.findFirst({
    where: {
      id: sessionId,
      userId: req.user.id,
    },
  });

  if (!session) {
    throw new AppError('Session not found', 404);
  }

  await prisma.refreshToken.update({
    where: { id: sessionId },
    data: { isRevoked: true },
  });

  res.json({
    success: true,
    message: 'Session revoked successfully',
  });
});

/**
 * Request password reset
 * POST /api/auth/forgot-password
 */
export const forgotPassword = asyncHandler(async (req: Request,res:Response)=>{
  const message='If an account exists with this email, password reset instructions will be emailed.';
  const user=await prisma.user.findUnique({where:{email:req.body.email}});
  if(!user || !user.isActive){res.json({success:true,message});return;}
  const resetToken=crypto.randomBytes(32).toString('hex'),hashedToken=crypto.createHash('sha256').update(resetToken).digest('hex');
  const expiresAt=new Date(Date.now()+config.security.passwordResetExpiry*60000);
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
    const current=await tx.user.findUnique({where:{id:user.id}});
    if(!current?.isActive || current.email!==user.email)return;
    await tx.user.update({where:{id:user.id},data:{passwordResetToken:hashedToken,passwordResetExpires:expiresAt}});
    await queueSecurityEmail(tx,current,'PASSWORD_RESET_REQUESTED',hashedToken,{resetToken,tokenHash:hashedToken,expiresAt});
  });
  res.json({success:true,message});
});

/**
 * Reset password with token
 * POST /api/auth/reset-password
 */
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body;

  if (!token || !password) {
    throw new AppError('Token and password are required', 400);
  }

  // Hash the provided token
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  // Find user with valid token
  const user = await prisma.user.findFirst({
    where: {
      passwordResetToken: hashedToken,
      passwordResetExpires: { gt: new Date() },
    },
  });

  if (!user) {
    throw new AppError('Invalid or expired reset token', 400);
  }

  // Password strength validation
  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 400);
  }

  if (!/[A-Z]/.test(password)) {
    throw new AppError('Password must contain at least one uppercase letter', 400);
  }

  if (!/[a-z]/.test(password)) {
    throw new AppError('Password must contain at least one lowercase letter', 400);
  }

  if (!/[0-9]/.test(password)) {
    throw new AppError('Password must contain at least one number', 400);
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    throw new AppError('Password must contain at least one special character', 400);
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Consume the reset token once, with password/session changes in the same transaction.
  await prisma.$transaction(async tx => {
  const changed = await tx.user.updateMany({
    where: { id: user.id, passwordResetToken: hashedToken, passwordResetExpires: { gt: new Date() } },
    data: {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
      failedLoginAttempts: 0,
      lockoutUntil: null,
    },
  });
  if (!changed.count) throw new AppError('Invalid or expired reset token', 400);
  await queueSecurityEmail(tx,user,'PASSWORD_RESET_COMPLETED',hashedToken);

  // Log activity
  await tx.activityLog.create({
    data: {
      userId: user.id,
      action: 'PASSWORD_RESET',
      entity: 'USER',
      entityId: user.id,
      locationId: user.locationId,
    },
  });
  });

  logger.info(`Password reset successful for: ${user.email}`);

  res.json({
    success: true,
    message: 'Password has been reset successfully. Please log in with your new password.',
  });
});

/**
 * Change password (for logged-in users)
 * POST /api/auth/change-password
 */
export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { currentPassword, newPassword } = req.body;
  if (req.body.confirmPassword !== undefined && req.body.confirmPassword !== newPassword) throw new AppError('New passwords do not match', 400);

  if (!currentPassword || !newPassword) {
    throw new AppError('Current password and new password are required', 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Verify current password
  const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
  if (!isPasswordValid) {
    throw new AppError('Current password is incorrect', 401);
  }

  // Password strength validation
  if (newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 400);
  }

  if (!/[A-Z]/.test(newPassword)) {
    throw new AppError('Password must contain at least one uppercase letter', 400);
  }

  if (!/[a-z]/.test(newPassword)) {
    throw new AppError('Password must contain at least one lowercase letter', 400);
  }

  if (!/[0-9]/.test(newPassword)) {
    throw new AppError('Password must contain at least one number', 400);
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) {
    throw new AppError('Password must contain at least one special character', 400);
  }

  // Check if new password is same as old
  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    throw new AppError('New password must be different from current password', 400);
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction(async tx => {
  // Reject a competing password change instead of overwriting its credentials.
  const changed = await tx.user.updateMany({
    where: { id: user.id, password: user.password, isActive: true },
    data: { password: hashedPassword },
  });
  if (!changed.count) throw new AppError('Account access changed. Sign in again.', 409);
  await queueSecurityEmail(tx,user,'PASSWORD_CHANGED',crypto.randomUUID());

  // Log activity
  await tx.activityLog.create({
    data: {
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      entity: 'USER',
      entityId: user.id,
      locationId: user.locationId,
    },
  });
  });

  logger.info(`Password changed for user: ${user.email}`);

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
});
