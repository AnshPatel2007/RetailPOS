import { UserRole } from '@prisma/client';
import { AuthRequest } from '../types';
import { AppError } from './errorHandler';

/** Shared by both user-creation endpoints. Store roles always belong to a store. */
export function resolveUserAssignment(req: AuthRequest, role: unknown, locationId: unknown) {
  const actor = req.user;
  if (!actor) throw new AppError('User not authenticated', 401);
  const assignedRole = role ?? 'CASHIER';
  if (!Object.values(UserRole).includes(assignedRole as UserRole)) {
    throw new AppError('Invalid user role', 400);
  }
  if (actor.role !== 'SUPER_ADMIN') {
    const allowed = actor.role === 'ADMIN' ? ['MANAGER', 'CASHIER']
      : actor.role === 'MANAGER' ? ['CASHIER'] : [];
    if (assignedRole === 'ADMIN' || assignedRole === 'SUPER_ADMIN') throw new AppError('Only super-admin can create admin users', 403);
    if (!allowed.includes(assignedRole as string)) throw new AppError('Insufficient permissions to assign this role', 403);
    if (!actor.locationId || (locationId != null && locationId !== actor.locationId)) {
      throw new AppError('You can only create users for your own location', 403);
    }
  }
  const assignedLocation = locationId ?? actor.locationId ?? null;
  if (assignedRole !== 'SUPER_ADMIN' && !assignedLocation) {
    throw new AppError('A store assignment is required for this role', 400);
  }
  return { role: assignedRole as UserRole, locationId: assignedLocation as string | null };
}
