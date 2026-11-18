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

  if (user.role !== 'SUPER_ADMIN') throw new AppError('A store assignment is required', 403);
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

/**
 * Assert the caller owns (belongs to the same location as) a fetched record,
 * before allowing a read-one/update/delete to proceed. SUPER_ADMIN always
 * passes. A record with locationId === null (shared/chain-wide) is only
 * mutable by SUPER_ADMIN — non-SUPER_ADMIN callers must match exactly.
 * @throws AppError (403) if the caller doesn't own the record
 */
export const assertOwnsRecord = (req: AuthRequest, recordLocationId: string | null): void => {
  if (isSuperAdmin(req)) return;
  if (!req.user?.locationId || recordLocationId !== req.user.locationId) {
    throw new AppError('You do not have access to this record', 403);
  }
};

/** Read access to an assigned store record; unassigned legacy records require administrative review. */
export const assertCanReadRecord = (
  req: AuthRequest,
  recordLocationId: string | null,
  notFoundMessage = 'Record not found'
): void => {
  if (isSuperAdmin(req)) return;
  if (!recordLocationId || recordLocationId !== req.user!.locationId) {
    throw new AppError(notFoundMessage, 404);
  }
};

/** Store-isolated list filter. Connections authorize inventory transfers only. */
export const getSharedOrOwnFilter = (req: AuthRequest, locationIdParam?: string): any => {
  // Legacy unassigned records are visible only to platform administrators for
  // ownership review. A transfer connection never grants data-sharing rights.
  return getLocationFilter(req, locationIdParam);
};

/** New store-owned records must have an explicit, authorized assignment. */
export const resolveWriteLocation = (req: AuthRequest, requested?: string | null): string => {
  const locationId = getLocationFilter(req, requested || undefined).locationId;
  if (!locationId) throw new AppError('Select a store before creating this record', 400);
  return locationId;
};

/**
 * Two-sided variant of assertOwnsRecord for records tied to two locations
 * (e.g. an inventory transfer's from/to store) — passes if the caller's own
 * location matches either one. SUPER_ADMIN always passes.
 * @throws AppError (403) if the caller doesn't own either location
 */
export const assertOwnsOneOfLocations = (
  req: AuthRequest,
  locationIds: (string | null)[]
): void => {
  if (isSuperAdmin(req)) return;
  if (!req.user?.locationId || !locationIds.includes(req.user.locationId)) {
    throw new AppError('You do not have access to this record', 403);
  }
};
