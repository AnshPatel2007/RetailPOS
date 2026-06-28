import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errorHandler';
import { UserRole } from '@prisma/client';
import prisma from '../config/database';

interface CachedUser {
  locationId: string | null;
  isActive: boolean;
  cachedAt: number;
}

// In-memory cache: userId → { locationId, isActive, cachedAt }
// Avoids a DB lookup on every single API request.
const userCache = new Map<string, CachedUser>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Invalidate a user's cached auth data.
 * Call this whenever a user is updated or deactivated.
 */
export const invalidateUserCache = (userId: string) => {
  userCache.delete(userId);
};

/**
 * Authentication middleware
 * Validates JWT token and attaches user to request.
 * User data (locationId, isActive) is cached for 5 minutes to reduce DB hits.
 */
export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401);
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    const now = Date.now();
    let cached = userCache.get(decoded.userId);

    // Cache miss or stale — fetch from DB
    if (!cached || now - cached.cachedAt > CACHE_TTL_MS) {
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { locationId: true, isActive: true },
      });

      if (!user) {
        throw new AppError('User not found or inactive', 401);
      }

      cached = { locationId: user.locationId, isActive: user.isActive, cachedAt: now };
      userCache.set(decoded.userId, cached);
    }

    if (!cached.isActive) {
      userCache.delete(decoded.userId);
      throw new AppError('User not found or inactive', 401);
    }

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      locationId: cached.locationId,
    };

    next();
  } catch (error) {
    next(new AppError('Invalid or expired token', 401));
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
