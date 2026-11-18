import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { getStoresOverview } from '../services/storeOverview.service';
import { addOwner, isOwner, organizationIdOf, ownedOrganizationIds, removeOwner } from '../services/organization.service';

/** Body validation with the first plain-language problem as the error. */
const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError(result.error.issues[0]?.message || 'Check the details and try again.', 400);
  return result.data;
};
const email = z.string({ required_error: 'Enter their email' }).trim().toLowerCase().email('Enter a valid email');
const fullName = (user: { firstName: string; lastName: string }) => `${user.firstName} ${user.lastName}`.trim();

/** GET /api/organization/overview — one card per store the caller runs as ADMIN. */
export const getOverview = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await getStoresOverview(req.user!.id, req.user!.locationId) });
});

async function ownedStores(userId: string) {
  const organizationIds = await ownedOrganizationIds(userId);
  if (!organizationIds.length) throw new AppError('Only an owner manages access to their stores', 403);
  const stores = await prisma.location.findMany({
    where: { organizationId: { in: organizationIds } },
    select: { id: true, name: true, isActive: true, organizationId: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return { organizationIds, stores };
}

/**
 * GET /api/organization/access — who may work in which of the caller's stores
 * (owners only). Home stores, owners and the extra access owners gave.
 */
export const listAccess = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { organizationIds, stores } = await ownedStores(req.user!.id);
  const [rows, owners] = await Promise.all([
    prisma.userStoreAccess.findMany({
      where: { locationId: { in: stores.map(store => store.id) } },
      select: { id: true, locationId: true, role: true, createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true, locationId: true } } },
      orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }, { id: 'asc' }],
    }),
    prisma.organizationOwner.findMany({ where: { organizationId: { in: organizationIds } }, select: { userId: true } }),
  ]);
  const ownerIds = new Set(owners.map(owner => owner.userId));
  res.json({ success: true, data: {
    stores: stores.map(({ organizationId: _organizationId, ...store }) => store),
    access: rows.map(row => ({
      id: row.id, locationId: row.locationId, role: row.role, createdAt: row.createdAt,
      userId: row.user.id, name: fullName(row.user), email: row.user.email, isActive: row.user.isActive,
      homeLocationId: row.user.locationId, isHome: row.user.locationId === row.locationId, isOwner: ownerIds.has(row.user.id),
    })),
  } });
});

/**
 * POST /api/organization/access { email, locationId, role } — an owner lets someone
 * who works in one of their stores also work in another, as a manager or cashier.
 * ADMIN access and ownership stay platform-admin decisions.
 */
export const grantAccess = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = parse(z.object({
    email,
    locationId: z.string({ required_error: 'Choose a store' }).min(1, 'Choose a store'),
    role: z.enum(['MANAGER', 'CASHIER'], { errorMap: () => ({ message: 'Choose Manager or Cashier' }) }),
  }), req.body);
  const actor = req.user!;
  const organizationId = await organizationIdOf(body.locationId);
  if (!await isOwner(actor.id, organizationId)) throw new AppError('Only an owner of this store can give access to it', 403);
  const person = await prisma.user.findUnique({ where: { email: body.email },
    select: { id: true, firstName: true, lastName: true, isActive: true, role: true, locationId: true, location: { select: { organizationId: true } } } });
  // Only people who already work in this business; nothing reveals accounts elsewhere.
  if (!person || person.role === 'SUPER_ADMIN' || person.location?.organizationId !== organizationId) {
    throw new AppError('No one with that email works in your stores', 404);
  }
  if (!person.isActive) throw new AppError('That account is turned off', 400);
  if (person.locationId === body.locationId) throw new AppError('That is their home store. Change their role on the Team page.', 409);
  const { row, created } = await prisma.$transaction(async tx => {
    const existing = await tx.userStoreAccess.findUnique({ where: { userId_locationId: { userId: person.id, locationId: body.locationId } } });
    if (existing?.role === 'ADMIN') throw new AppError('They already run this store as an owner or admin', 409);
    const saved = existing
      ? await tx.userStoreAccess.update({ where: { id: existing.id }, data: { role: body.role } })
      : await tx.userStoreAccess.create({ data: { userId: person.id, locationId: body.locationId, role: body.role, createdById: actor.id } });
    await tx.activityLog.create({ data: { userId: actor.id, action: 'STORE_ACCESS_GRANTED', entity: 'USER', entityId: person.id, locationId: body.locationId,
      details: { role: body.role, ...(existing ? { previousRole: existing.role } : {}) } } });
    return { row: saved, created: !existing };
  });
  res.status(created ? 201 : 200).json({ success: true, data: { id: row.id, locationId: row.locationId, role: row.role, userId: person.id, name: fullName(person) } });
});

/** DELETE /api/organization/access/:id — end extra access an owner gave. */
export const removeAccess = asyncHandler(async (req: AuthRequest, res: Response) => {
  const actor = req.user!;
  const row = await prisma.userStoreAccess.findUnique({ where: { id: req.params.id },
    select: { id: true, userId: true, locationId: true, role: true, user: { select: { locationId: true } }, location: { select: { organizationId: true } } } });
  if (!row || !row.location.organizationId || !await isOwner(actor.id, row.location.organizationId)) throw new AppError('Access not found', 404);
  if (row.user.locationId === row.locationId) throw new AppError('This is their home store. Turn the account off on the Team page instead.', 409);
  if (row.role === 'ADMIN') throw new AppError('Owner and admin access is changed by the platform administrator', 409);
  await prisma.$transaction(async tx => {
    // Their cash must be counted where it was taken: a drawer open at this store is closed first.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${row.userId} FOR UPDATE`;
    if (await tx.shift.findFirst({ where: { userId: row.userId, locationId: row.locationId, isClosed: false }, select: { id: true } })) {
      throw new AppError('They have a drawer open at this store. Close it before removing their access.', 409);
    }
    await tx.userStoreAccess.delete({ where: { id: row.id } });
    await tx.activityLog.create({ data: { userId: actor.id, action: 'STORE_ACCESS_REMOVED', entity: 'USER', entityId: row.userId, locationId: row.locationId, details: { role: row.role } } });
  });
  res.json({ success: true, message: 'Access removed' });
});

/** GET /api/organizations — every business with its stores and owners (platform admin). */
export const listOrganizations = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const organizations = await prisma.organization.findMany({
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, createdAt: true,
      locations: { select: { id: true, name: true, isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] },
      owners: { select: { user: { select: { id: true, firstName: true, lastName: true, email: true, locationId: true } } }, orderBy: { createdAt: 'asc' } } },
  });
  res.json({ success: true, data: organizations.map(organization => ({ ...organization,
    owners: organization.owners.map(({ user }) => ({ userId: user.id, name: fullName(user), email: user.email, homeLocationId: user.locationId })) })) });
});

/** POST /api/organizations { name } — a new, empty business; move stores into it from the store list. */
export const createOrganization = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name } = parse(z.object({ name: z.string({ required_error: 'Name the business' }).trim().min(1, 'Name the business').max(120, 'Use a shorter name') }), req.body);
  const organization = await prisma.organization.create({ data: { name }, select: { id: true, name: true, createdAt: true } });
  res.status(201).json({ success: true, data: { ...organization, locations: [], owners: [] } });
});

/** POST /api/organizations/:id/owners { email } — the person gets ADMIN access to every store of the business. */
export const addOrganizationOwner = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = parse(z.object({ email }), req.body);
  if (!await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true } })) throw new AppError('Organization not found', 404);
  const person = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  if (!person) throw new AppError('No active account has that email.', 404);
  await prisma.$transaction(tx => addOwner(tx, req.params.id, person.id, req.user!.id));
  res.status(201).json({ success: true, message: 'Owner added' });
});

/** DELETE /api/organizations/:id/owners/:userId — their access to the business's other stores ends. */
export const removeOrganizationOwner = asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.$transaction(tx => removeOwner(tx, req.params.id, req.params.userId, req.user!.id));
  res.json({ success: true, message: 'Owner removed' });
});
