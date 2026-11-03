import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errorHandler';
import { UserRole } from '@prisma/client';
import prisma from '../config/database';
import { can, Capability } from '../policies/capabilities';
import { omitWageDetails } from '../utils/wagePrivacy';

const operationAreas = new Set(['products', 'categories', 'sales', 'customers', 'shifts', 'reports', 'expenses', 'suppliers', 'purchase-orders', 'analytics', 'financial', 'gift-cards', 'store-credit', 'exchanges', 'inventory-transfers', 'cycle-counts', 'lottery', 'audit-logs', 'promotions', 'house-accounts', 'payroll', 'offline']);
const restrictedAreas: Record<string, Capability> = {
  payroll: 'payroll.manage', expenses: 'financial.read', financial: 'financial.read',
  suppliers: 'inventory.read', 'purchase-orders': 'inventory.read', 'inventory-transfers': 'inventory.read',
  'cycle-counts': 'inventory.read', analytics: 'report.read', 'audit-logs': 'activity.read',
};

// Kept for callers; authorization now reads current data on every request.
export const invalidateUserCache = (_userId: string) => {};

/**
 * Authentication middleware
 * Validates JWT token and attaches user to request.
 * Read current permissions so demotions apply across every API process immediately.
 */
export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401);
    }

    const token = authHeader.substring(7);
    let decoded;
    try { decoded = verifyToken(token); }
    catch { throw new AppError('Invalid or expired token', 401); }
    if (!decoded.sessionId) throw new AppError('This session must be renewed. Sign in again if renewal fails.', 401);

    const currentUser = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { locationId: true, isActive: true, role: true, email: true, location: { select: { isActive: true } },
        refreshTokens: { where: { id: decoded.sessionId, isRevoked: false, expiresAt: { gt: new Date() } }, select: { id: true } } },
    });
    if (!currentUser?.isActive) throw new AppError('User not found or inactive', 401);
    if (!currentUser.refreshTokens.length) throw new AppError('Session expired or revoked. Sign in again.', 401);
    if (currentUser.role !== 'SUPER_ADMIN' && !currentUser.locationId) {
      throw new AppError('A store assignment is required', 403);
    }

    req.user = {
      id: decoded.userId,
      email: currentUser.email,
      role: currentUser.role,
      locationId: currentUser.locationId,
    };
    req.sessionId = decoded.sessionId;

    const area = (req.baseUrl || '').split('/').filter(Boolean).pop() || '';
    const writing = !['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET');
    const connections = area === 'inventory-transfers' && /^\/connections(?:\/|$)/.test(req.path || '');
    // Equipment configuration is a platform operation; lottery business writes
    // remain prohibited for platform sessions and have their own role checks.
    const lotteryConfiguration = area === 'lottery' && req.method === 'POST' && /^\/v2\/(?:configuration(?:\/[^/]+)?|equipment\/[^/]+)\/?$/.test(req.path || '');
    if (restrictedAreas[area] && !can(currentUser.role, restrictedAreas[area])) throw new AppError('Insufficient permissions', 403);
    if (writing && operationAreas.has(area) && !connections && !lotteryConfiguration) {
      if (currentUser.role === 'SUPER_ADMIN') throw new AppError('Store preview is read-only', 403);
      if (currentUser.location?.isActive === false) throw new AppError('This store is inactive. Historical records remain available.', 403);
    }
    if (!can(currentUser.role, 'payroll.manage') && res.json) {
      const json = res.json.bind(res);
      res.json = (body: unknown) => json(omitWageDetails(body));
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role-based authorization middleware
 */
export const authorize = (...roles: UserRole[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('User not authenticated', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
};

export const requireCapability = (capability: Capability) => (req: AuthRequest, _res: Response, next: NextFunction) => {
  if (!can(req.user?.role, capability)) return next(new AppError('Insufficient permissions', 403));
  return next();
};
