import { Prisma, UserRole } from '@prisma/client';
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
 * The role a person has at a store, or null when they may not work there. The home
 * store's row always exists (users_sync_home_access), so this covers home and other stores.
 */
export async function roleAtStore(userId: string, locationId: string, client: Client = prisma): Promise<UserRole | null> {
  const access = await client.userStoreAccess.findUnique({
    where: { userId_locationId: { userId, locationId } },
    select: { role: true },
  });
  return access && access.role !== 'SUPER_ADMIN' ? access.role : null;
}

/** Stock may move between two stores of one organization, or between stores a platform admin linked. */
export async function storesConnected(a: string, b: string, client: Client = prisma): Promise<boolean> {
  const [locationAId, locationBId] = [a, b].sort();
  if (await client.storeConnection.findUnique({ where: { locationAId_locationBId: { locationAId, locationBId } }, select: { id: true } })) return true;
  const stores = await client.location.findMany({ where: { id: { in: [a, b] } }, select: { organizationId: true } });
  return stores.length === 2 && !!stores[0].organizationId && stores[0].organizationId === stores[1].organizationId;
}

/** Other stores that stock may move to from this one: same organization or linked. */
export async function connectedStoreIds(locationId: string, client: Client = prisma): Promise<string[]> {
  const [links, store] = await Promise.all([
    client.storeConnection.findMany({ where: { OR: [{ locationAId: locationId }, { locationBId: locationId }] }, select: { locationAId: true, locationBId: true } }),
    client.location.findUnique({ where: { id: locationId }, select: { organizationId: true } }),
  ]);
  const siblings = store?.organizationId
    ? await client.location.findMany({ where: { organizationId: store.organizationId, id: { not: locationId } }, select: { id: true } })
    : [];
  return [...new Set([...links.map(link => link.locationAId === locationId ? link.locationBId : link.locationAId), ...siblings.map(row => row.id)])];
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

/** Organizations this person owns. */
export async function ownedOrganizationIds(userId: string, client: Client = prisma): Promise<string[]> {
  return (await client.organizationOwner.findMany({ where: { userId }, select: { organizationId: true } })).map(row => row.organizationId);
}

/**
 * Make someone an owner of an organization: ADMIN access to all of its stores.
 * Only a person who is an ADMIN at one of its stores (their home store) can own it,
 * so owning never changes anyone's role at home.
 */
export async function addOwner(tx: Prisma.TransactionClient, organizationId: string, userId: string, createdById: string) {
  const person = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true, location: { select: { id: true, organizationId: true } } } });
  if (!person?.isActive) throw new AppError('No active account has that email.', 404);
  if (person.role !== 'ADMIN' || person.location?.organizationId !== organizationId) {
    throw new AppError('An owner must be an admin of one of this business\'s stores.', 400);
  }
  await tx.organizationOwner.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, userId, createdById },
    update: {},
  });
  await syncOwnerAccess(tx, organizationId, createdById);
  await tx.activityLog.create({ data: { userId: createdById, action: 'OWNER_ADDED', entity: 'USER', entityId: userId, locationId: person.location.id, details: { organizationId } } });
}

/** End someone's ownership: their ADMIN access to the organization's other stores goes; their home store stays. */
export async function removeOwner(tx: Prisma.TransactionClient, organizationId: string, userId: string, actorId: string) {
  const removed = await tx.organizationOwner.deleteMany({ where: { organizationId, userId } });
  if (!removed.count) throw new AppError('That person is not an owner of this business.', 404);
  const person = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { locationId: true } });
  await tx.userStoreAccess.deleteMany({
    where: { userId, role: 'ADMIN', location: { organizationId }, ...(person.locationId ? { locationId: { not: person.locationId } } : {}) },
  });
  await tx.activityLog.create({ data: { userId: actorId, action: 'OWNER_REMOVED', entity: 'USER', entityId: userId, locationId: person.locationId, details: { organizationId } } });
}

/**
 * Move a store to another organization (null: a new one of its own, named after the
 * store). Access that came from the old organization ends: its owners' ADMIN access and
 * grants between this store and the old organization's people and stores. Home stores
 * and home roles never change here. The new organization's owners get ADMIN access.
 */
export async function moveStoreToOrganization(tx: Prisma.TransactionClient, locationId: string, organizationId: string | null, actorId: string) {
  const previous = await organizationIdOf(locationId, tx);
  if (previous === organizationId) return previous;
  if (organizationId && !await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } })) throw new AppError('Organization not found', 404);
  // Rows at this store for people whose home is elsewhere in the old organization, and rows
  // elsewhere in the old organization for this store's own people. Home rows are never touched.
  const oldStores = (await tx.location.findMany({ where: { organizationId: previous, id: { not: locationId } }, select: { id: true } })).map(store => store.id);
  await tx.userStoreAccess.deleteMany({ where: { locationId, user: { locationId: { in: oldStores } } } });
  await tx.userStoreAccess.deleteMany({ where: { locationId: { in: oldStores }, user: { locationId } } });
  // Owners of the old organization stop administering this store (unless it is their home).
  await tx.userStoreAccess.deleteMany({ where: { locationId, role: 'ADMIN', user: { organizationOwnerships: { some: { organizationId: previous } }, locationId: { not: locationId } } } });
  // The database gives the store a new organization of its own when none is chosen.
  const moved = await tx.location.update({ where: { id: locationId }, data: { organizationId }, select: { organizationId: true } });
  await syncOwnerAccess(tx, moved.organizationId!, actorId);
  await tx.activityLog.create({ data: { userId: actorId, action: 'STORE_MOVED', entity: 'LOCATION', entityId: locationId, locationId, details: { fromOrganizationId: previous, toOrganizationId: moved.organizationId } } });
  return moved.organizationId!;
}
