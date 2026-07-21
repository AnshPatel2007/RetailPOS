import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { generateToken, generateRefreshToken } from '../utils/jwt';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { config } from '../config';
import { logger } from '../utils/logger';
import { verifyTOTPCode } from './twoFactor.controller';
import { sendPasswordResetEmail, sendAccountLockoutEmail } from '../utils/email';

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
const handleFailedLogin = async (user: any): Promise<void> => {
  const attempts = user.failedLoginAttempts + 1;

  if (attempts >= config.security.maxLoginAttempts) {
    const lockoutUntil = new Date(
      Date.now() + config.security.lockoutDuration * 60000
    );

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockoutUntil,
      },
    });

    // Send lockout notification email
    try {
      await sendAccountLockoutEmail(
        user.email,
        user.firstName,
        config.security.lockoutDuration
      );
    } catch (error) {
      logger.error('Failed to send lockout email:', error);
    }

    logger.warn(`Account locked for user: ${user.email}`);
    throw new AppError(
      `Account locked due to too many failed attempts. Try again in ${config.security.lockoutDuration} minutes.`,
      423
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: attempts,
    },
  });
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

  // Generate tokens
  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const refreshToken = generateRefreshToken();

  // Store refresh token
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      deviceInfo: req.headers['user-agent'] || 'Unknown',
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
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
    },
  });

  logger.info(`User logged in: ${user.email}`);

  // Set refresh token as httpOnly cookie
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
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
        location: user.location,
        twoFactorEnabled: user.twoFactorEnabled,
      },
    },
  });
});

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
    userId: storedToken.user.id,
    email: storedToken.user.email,
    role: storedToken.user.role,
  });

  // Update last used
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { lastUsedAt: new Date() },
  });

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
      location: {
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          state: true,
        },
      },
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    data: user,
  });
});

/**
 * Register new user (Admin only)
 * POST /api/auth/register
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
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

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: role || 'CASHIER',
      locationId,
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
  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    // Revoke refresh token
    await prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { isRevoked: true },
    });
  }

  if (req.user) {
    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'LOGOUT',
        entity: 'USER',
        entityId: req.user.id,
        locationId: req.user.locationId,
      },
    });
  }

  // Clear refresh token cookie
  res.clearCookie('refreshToken');

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
  res.clearCookie('refreshToken');

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
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  // Always return success to prevent email enumeration
  if (!user) {
    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.',
    });
    return;
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

  // Store hashed token with expiry
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: hashedToken,
      passwordResetExpires: new Date(
        Date.now() + config.security.passwordResetExpiry * 60000
      ),
    },
  });

  // Send reset email
  try {
    await sendPasswordResetEmail(user.email, resetToken, user.firstName);
    logger.info(`Password reset email sent to: ${user.email}`);
  } catch (error) {
    // The underlying SMTP error is swallowed by sendEmail's generic rethrow —
    // log it here too so the real cause (auth failure, timeout, etc.) is
    // visible next to the request that triggered it, not just buried under
    // email.ts's own "Error sending email:" log line.
    logger.error(`Failed to send password reset email to ${user.email}:`, error);
    // Clear token on email failure
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });
    throw new AppError('Failed to send password reset email', 500);
  }

  res.json({
    success: true,
    message: 'If an account exists with this email, a password reset link has been sent.',
  });
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

  // Update password and clear reset token
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
      failedLoginAttempts: 0,
      lockoutUntil: null,
    },
  });

  // Revoke all refresh tokens (force re-login)
  await prisma.refreshToken.updateMany({
    where: { userId: user.id },
    data: { isRevoked: true },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: 'PASSWORD_RESET',
      entity: 'USER',
      entityId: user.id,
      locationId: user.locationId,
    },
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

  // Update password
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      entity: 'USER',
      entityId: user.id,
      locationId: user.locationId,
    },
  });

  logger.info(`Password changed for user: ${user.email}`);

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
});
