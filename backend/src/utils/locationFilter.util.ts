import { AuthRequest } from '../types';
import { AppError } from './errorHandler';

/**
 * Get location filter for database queries with SUPER_ADMIN support
 * @param req - The authenticated request
 * @param locationIdParam - Optional locationId from query parameters
 * @returns Location filter object for Prisma queries
 */
export const getLocationFilter = (
  req: AuthRequest,
  locationIdParam?: string
): { locationId?: string } => {
  const user = req.user!;

  // If locationId is provided in query params
  if (locationIdParam) {
    // SUPER_ADMIN can query any location
    if (user.role === 'SUPER_ADMIN') {
      return { locationId: locationIdParam };
    }

    // Other users can only query their own location
    if (user.locationId && locationIdParam === user.locationId) {
      return { locationId: locationIdParam };
    }

    // Trying to access a different location
    throw new AppError('You can only access your own location', 403);
  }

  // Regular users and admins use their own locationId
  if (user.locationId) {
    return { locationId: user.locationId };
  }

  // SUPER_ADMIN without locationId param sees all locations
  return {};
};

/**
 * Validate that user has permission to access a specific location
 * @param req - The authenticated request
 * @param targetLocationId - The location being accessed
 * @throws AppError if user doesn't have permission
 */
export const validateLocationAccess = (
  req: AuthRequest,
  targetLocationId: string
): void => {
  const user = req.user!;

  // SUPER_ADMIN can access any location
  if (user.role === 'SUPER_ADMIN') {
    return;
  }

  // Other users can only access their own location
  if (user.locationId !== targetLocationId) {
    throw new AppError('You can only access your own location', 403);
  }
};

/**
 * Check if user is SUPER_ADMIN
 * @param req - The authenticated request
 * @returns true if user is SUPER_ADMIN
 */
export const isSuperAdmin = (req: AuthRequest): boolean => {
  return req.user?.role === 'SUPER_ADMIN';
};
