import { User, UserRole } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';

export const STORE_ACCESS_ENDED = 'STORE_ACCESS_ENDED';

/**
 * Starts a sign-in session. `activeLocationId` is the store it works in when that is not
 * the person's home store (a PIN sign-in on another store's register); null means home.
 */
export async function createLoginSession(verified: User, token: string, deviceInfo: string, ipAddress?: string, activeLocationId: string | null = null) {
  return prisma.$transaction(async tx => {
    // A password/authority change must not race a login using old credentials.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${verified.id} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: verified.id } });
    if (!current?.isActive || current.password !== verified.password || current.role !== verified.role || current.locationId !== verified.locationId || current.twoFactorEnabled !== verified.twoFactorEnabled || current.twoFactorSecret !== verified.twoFactorSecret || current.twoFactorVersion !== verified.twoFactorVersion) {
      throw new AppError('Account access changed. Sign in again.', 401);
    }
    if (current.role !== 'SUPER_ADMIN' && !current.locationId) throw new AppError('A store assignment is required', 403);
    const active = activeLocationId && activeLocationId !== current.locationId ? activeLocationId : null;
    if (active && !await tx.userStoreAccess.findUnique({ where: { userId_locationId: { userId: current.id, locationId: active } }, select: { id: true } })) {
      throw new AppError('Account access changed. Sign in again.', 401);
    }
    return tx.refreshToken.create({ data: { token, userId: current.id, deviceInfo, ipAddress, activeLocationId: active, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
  });
}

interface AccessRow { locationId: string; role: UserRole }

/**
 * The store a session works in and the role there. A session that switched to another
 * store uses that store's access row; null when that access no longer exists.
 */
export function actingStore(user: { role: UserRole; locationId: string | null; storeAccess: AccessRow[] }, activeLocationId: string | null | undefined) {
  if (user.role === 'SUPER_ADMIN' || !activeLocationId || activeLocationId === user.locationId) {
    return { locationId: user.locationId, role: user.role };
  }
  const access = user.storeAccess.find(row => row.locationId === activeLocationId);
  return access && access.role !== 'SUPER_ADMIN' ? { locationId: access.locationId, role: access.role } : null;
}

const locationFields = { id: true, name: true, address: true, city: true, state: true, timezone: true, isActive: true } as const;

/**
 * The signed-in person as the app sees them in this session: the acting store's role,
 * store and organization, plus their home store and every store they may switch to.
 * Shared by sign-in, GET /auth/me and store switching.
 */
export async function sessionUser(userId: string, activeLocationId: string | null | undefined) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, locationId: true,
      twoFactorEnabled: true, pinHash: true, createdAt: true, lastLoginAt: true,
      storeAccess: { select: { locationId: true, role: true, location: { select: { name: true, isActive: true } } } },
    },
  });
  if (!user) throw new AppError('User not found', 404);
  const acting = actingStore(user, activeLocationId);
  if (!acting) throw new AppError('Your access to this store ended. You are back at your home store.', 403, { code: STORE_ACCESS_ENDED });

  const location = acting.locationId
    ? await prisma.location.findUnique({ where: { id: acting.locationId }, select: locationFields })
    : null;
  const organization = location && user.role !== 'SUPER_ADMIN'
    ? await prisma.organization.findFirst({
      where: { locations: { some: { id: location.id } } },
      select: { id: true, name: true, _count: { select: { locations: true } }, owners: { where: { userId }, select: { id: true } } },
    })
    : null;

  const stores = user.role === 'SUPER_ADMIN' ? [] : user.storeAccess
    .map(row => ({ locationId: row.locationId, name: row.location.name, role: row.role, isActive: row.location.isActive,
      isHome: row.locationId === user.locationId, isCurrent: row.locationId === acting.locationId }))
    .sort((a, b) => Number(b.isHome) - Number(a.isHome) || a.name.localeCompare(b.name));

  const { pinHash, storeAccess: _rows, role: homeRole, locationId: homeLocationId, ...profile } = user;
  return {
    ...profile,
    // Only whether a register PIN is set ever leaves the server, never its hash.
    hasPin: !!pinHash,
    role: acting.role,
    locationId: acting.locationId,
    location,
    homeLocationId,
    homeRole,
    stores,
    organization: organization
      ? { id: organization.id, name: organization.name, storeCount: organization._count.locations, isOwner: organization.owners.length > 0 }
      : null,
  };
}

export type SessionUser = Awaited<ReturnType<typeof sessionUser>>;
