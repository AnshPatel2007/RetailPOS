import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';

type Client = Prisma.TransactionClient | typeof prisma;

/**
 * The organization that owns a store. The database gives every store one
 * (locations_default_organization trigger), so a missing value is a fault, never a
 * state to work around.
 */
export async function organizationIdOf(locationId: string, client: Client = prisma): Promise<string> {
  const store = await client.location.findUnique({ where: { id: locationId }, select: { organizationId: true } });
  if (!store) throw new AppError('Store not found', 404);
  if (!store.organizationId) throw new AppError('This store has no organization', 500);
  return store.organizationId;
}

export async function isOwner(userId: string, organizationId: string, client: Client = prisma): Promise<boolean> {
  const owner = await client.organizationOwner.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true },
  });
  return owner !== null;
}

/**
 * Every owner of an organization may work in every one of its stores as ADMIN.
 * Call after adding an owner or a store. It only grants or raises access, never
 * removes it. Platform admins have no store access of their own and are skipped.
 */
export async function syncOwnerAccess(tx: Prisma.TransactionClient, organizationId: string, createdById: string | null = null) {
  const owners = await tx.organizationOwner.findMany({
    where: { organizationId, user: { role: { not: 'SUPER_ADMIN' } } },
    select: { userId: true },
  });
  const stores = await tx.location.findMany({ where: { organizationId }, select: { id: true } });
  if (!owners.length || !stores.length) return { granted: 0, raised: 0 };

  const userIds = owners.map(owner => owner.userId);
  const locationIds = stores.map(store => store.id);
  const granted = await tx.userStoreAccess.createMany({
    data: userIds.flatMap(userId => locationIds.map(locationId => ({ userId, locationId, role: 'ADMIN' as const, createdById }))),
    skipDuplicates: true,
  });
  const raised = await tx.userStoreAccess.updateMany({
    where: { userId: { in: userIds }, locationId: { in: locationIds }, role: { not: 'ADMIN' } },
    data: { role: 'ADMIN' },
  });
  return { granted: granted.count, raised: raised.count };
}
