import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import prisma from '../config/database';
import { config } from '../config';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import { completeSignIn } from './auth.controller';
import { roleAtStore } from '../services/organization.service';

/**
 * Register PIN sign-in.
 *
 * A manager or owner sets a computer up as a register; it keeps a random secret
 * (only its SHA-256 hash is stored here). On that register, staff of the same
 * store pick their name and enter a 4-6 digit PIN. A PIN alone never signs anyone
 * in: it only works with a live register secret for the person's own store.
 * Accounts with two-step sign-in keep using email, password and code.
 */

const PIN_ROLES = ['ADMIN', 'MANAGER', 'CASHIER'] as const;
const pinSchema = z.string({ required_error: 'Enter a PIN' }).regex(/^\d{4,6}$/, 'A PIN is 4 to 6 digits');
const deviceTokenSchema = z.string().min(20).max(200);

/** Body validation with the first plain-language problem as the error. */
const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError(result.error.issues[0]?.message || 'Check the details and try again.', 400);
  return result.data;
};

export const hashDeviceToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** 1111, 1234, 9876... are the first guesses anyone tries. */
export const isGuessablePin = (pin: string) => {
  if (/^(\d)\1+$/.test(pin)) return true;
  const steps = new Set([...pin].slice(1).map((digit, index) => (Number(digit) - Number(pin[index]) + 10) % 10));
  return steps.size === 1 && (steps.has(1) || steps.has(9));
};

const displayName = (user: { firstName: string; lastName: string }) =>
  `${user.firstName} ${user.lastName ? user.lastName[0] + '.' : ''}`.trim();

async function liveDevice(token: unknown) {
  const parsed = deviceTokenSchema.safeParse(token);
  if (!parsed.success) throw new AppError('This computer is not set up for PIN sign-in.', 401);
  const device = await prisma.registerDevice.findUnique({ where: { tokenHash: hashDeviceToken(parsed.data) }, include: { location: { select: { id: true, name: true, isActive: true } } } });
  if (!device || device.revokedAt) throw new AppError('This computer is no longer set up for PIN sign-in. Sign in with email, then set it up again in Settings > Devices.', 401);
  if (!device.location.isActive) throw new AppError('This store is inactive.', 403);
  return device;
}

/**
 * A failed PIN counts against PIN sign-in only; the password sign-in is unaffected.
 * Unlocking answers 422 (the session itself is fine), signing in answers 401.
 */
async function recordWrongPin(userId: string, status: number) {
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: userId }, select: { pinFailedAttempts: true } });
    const attempts = (current?.pinFailedAttempts || 0) + 1;
    const locked = attempts >= config.security.maxLoginAttempts;
    await tx.user.update({ where: { id: userId }, data: locked
      ? { pinFailedAttempts: 0, pinLockoutUntil: new Date(Date.now() + config.security.lockoutDuration * 60000) }
      : { pinFailedAttempts: attempts } });
    return { locked, left: config.security.maxLoginAttempts - attempts };
  });
  if (result.locked) throw new AppError(`Too many wrong PINs. PIN sign-in is paused for ${config.security.lockoutDuration} minutes; sign in with email meanwhile.`, 423);
  throw new AppError(`Wrong PIN. ${result.left} ${result.left === 1 ? 'try' : 'tries'} left.`, status);
}

function assertPinUsable(user: { pinHash: string | null; pinLockoutUntil: Date | null; twoFactorEnabled: boolean }) {
  if (user.twoFactorEnabled) throw new AppError('This account uses two-step sign-in. Sign in with email, password and code.', 403);
  if (!user.pinHash) throw new AppError('No PIN is set for this account. Sign in with email and set one in Settings.', 403);
  if (user.pinLockoutUntil && user.pinLockoutUntil > new Date()) {
    const minutes = Math.ceil((user.pinLockoutUntil.getTime() - Date.now()) / 60000);
    throw new AppError(`Too many wrong PINs. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or sign in with email.`, 423);
  }
}

async function checkPin(user: { id: string; pinHash: string | null }, pin: string, wrongStatus = 401) {
  if (!user.pinHash || !(await bcrypt.compare(pin, user.pinHash))) await recordWrongPin(user.id, wrongStatus);
  await prisma.user.update({ where: { id: user.id }, data: { pinFailedAttempts: 0, pinLockoutUntil: null } });
}

/** PUT /api/auth/pin — set or change your own PIN (needs your password). */
export const setPin = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { currentPassword, pin } = parse(z.object({ currentPassword: z.string({ required_error: 'Enter your password' }).min(1, 'Enter your password'), pin: pinSchema }), req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) throw new AppError('User not found', 404);
  if (!PIN_ROLES.includes(user.role as typeof PIN_ROLES[number]) || !user.locationId) throw new AppError('PIN sign-in is for store staff.', 403);
  if (user.twoFactorEnabled) throw new AppError('This account uses two-step sign-in, which a PIN would bypass. Keep signing in with email, password and code.', 403);
  if (!(await bcrypt.compare(currentPassword, user.password))) throw new AppError('Current password is incorrect', 401);
  if (isGuessablePin(pin)) throw new AppError('Choose a PIN that is harder to guess (not 1111 or 1234).', 400);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { pinHash: await bcrypt.hash(pin, 10), pinSetAt: new Date(), pinFailedAttempts: 0, pinLockoutUntil: null } }),
    prisma.activityLog.create({ data: { userId: user.id, action: user.pinHash ? 'PIN_CHANGED' : 'PIN_SET', entity: 'USER', entityId: user.id, locationId: req.user!.locationId } }),
  ]);
  res.json({ success: true, message: 'PIN saved' });
});

/** DELETE /api/auth/pin — stop using a PIN. */
export const removePin = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, pinHash: true, locationId: true } });
  if (!user) throw new AppError('User not found', 404);
  if (user.pinHash) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { pinHash: null, pinSetAt: null, pinFailedAttempts: 0, pinLockoutUntil: null } }),
      prisma.activityLog.create({ data: { userId: user.id, action: 'PIN_REMOVED', entity: 'USER', entityId: user.id, locationId: req.user!.locationId } }),
    ]);
  }
  res.json({ success: true, message: 'PIN removed' });
});

/** POST /api/auth/pin/verify — unlock your own locked register screen. */
export const verifyPin = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { pin } = parse(z.object({ pin: pinSchema }), req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, pinHash: true, pinLockoutUntil: true, twoFactorEnabled: true } });
  if (!user) throw new AppError('User not found', 404);
  assertPinUsable(user);
  await checkPin(user, pin, 422);
  res.json({ success: true });
});

/** POST /api/auth/registers — set this computer up as a register for your store. */
export const createRegister = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name } = parse(z.object({ name: z.string({ required_error: 'Name this register' }).trim().min(1, 'Name this register').max(60, 'Use a shorter name (60 characters at most)') }), req.body);
  const locationId = req.user!.locationId;
  if (!locationId) throw new AppError('A store assignment is required', 403);
  const token = crypto.randomBytes(32).toString('base64url');
  const device = await prisma.$transaction(async tx => {
    const created = await tx.registerDevice.create({ data: { locationId, name, tokenHash: hashDeviceToken(token), createdById: req.user!.id }, include: { location: { select: { name: true } } } });
    await tx.activityLog.create({ data: { userId: req.user!.id, action: 'REGISTER_SET_UP', entity: 'REGISTER_DEVICE', entityId: created.id, locationId, details: { name } } });
    return created;
  });
  // The secret is shown once, to this computer; only its hash is kept.
  res.status(201).json({ success: true, data: { id: device.id, name: device.name, storeName: device.location.name, token } });
});

/** GET /api/auth/registers — the store's registers that allow PIN sign-in. */
export const listRegisters = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = req.user!.locationId;
  if (!locationId) throw new AppError('A store assignment is required', 403);
  const devices = await prisma.registerDevice.findMany({
    where: { locationId, revokedAt: null }, orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true, createdBy: { select: { firstName: true, lastName: true } } },
  });
  res.json({ success: true, data: devices.map(device => ({ ...device, createdBy: device.createdBy ? displayName(device.createdBy) : null })) });
});

/** DELETE /api/auth/registers/:id — stop PIN sign-in on a register (lost or replaced computer). */
export const revokeRegister = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = req.user!.locationId;
  const revoked = await prisma.registerDevice.updateMany({ where: { id: req.params.id, locationId: locationId || '__none__', revokedAt: null }, data: { revokedAt: new Date() } });
  if (!revoked.count) throw new AppError('Register not found', 404);
  await prisma.activityLog.create({ data: { userId: req.user!.id, action: 'REGISTER_REMOVED', entity: 'REGISTER_DEVICE', entityId: req.params.id, locationId } });
  res.json({ success: true, message: 'Register removed' });
});

/** POST /api/auth/register-staff — who can sign in with a PIN on this register: everyone who may work in its store. */
export const registerStaff = asyncHandler(async (req: Request, res: Response) => {
  const device = await liveDevice(req.body?.deviceToken);
  const staff = await prisma.userStoreAccess.findMany({
    where: { locationId: device.locationId, role: { in: [...PIN_ROLES] },
      user: { isActive: true, pinHash: { not: null }, twoFactorEnabled: false, role: { not: 'SUPER_ADMIN' } } },
    orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }],
    select: { role: true, user: { select: { id: true, firstName: true, lastName: true } } },
  });
  res.json({ success: true, data: { register: { id: device.id, name: device.name, storeName: device.location.name }, staff: staff.map(row => ({ id: row.user.id, name: displayName(row.user), role: row.role })) } });
});

/** POST /api/auth/pin-login — sign in on a set-up register with name + PIN. */
export const pinLogin = asyncHandler(async (req: Request, res: Response) => {
  const { deviceToken, userId, pin } = parse(z.object({ deviceToken: deviceTokenSchema, userId: z.string({ required_error: 'Choose who is signing in' }).min(1, 'Choose who is signing in').max(100), pin: pinSchema }), req.body);
  const device = await liveDevice(deviceToken);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  // Someone without access to this register's store, or an inactive account, is simply not on this register.
  const role = user?.isActive && user.role !== 'SUPER_ADMIN' ? await roleAtStore(user.id, device.locationId) : null;
  if (!user || !role || !PIN_ROLES.includes(role as typeof PIN_ROLES[number])) {
    throw new AppError('That person cannot sign in on this register.', 401);
  }
  if (user.lockoutUntil && user.lockoutUntil > new Date()) throw new AppError('This account is temporarily locked. Try again later.', 423);
  assertPinUsable(user);
  await checkPin(user, pin);
  // Switching cashier: the session this browser already holds (its refresh cookie)
  // belongs to the previous person at this register, so it ends here. A wrong PIN
  // never reaches this point, so the previous person stays signed in.
  const previous = typeof req.cookies?.refreshToken === 'string' ? req.cookies.refreshToken : null;
  if (previous) {
    const old = await prisma.refreshToken.findUnique({ where: { token: previous }, include: { user: { select: { locationId: true } } } });
    if (old && !old.isRevoked) {
      await prisma.$transaction(async tx => {
        const revoked = await tx.refreshToken.updateMany({ where: { id: old.id, isRevoked: false }, data: { isRevoked: true } });
        if (revoked.count) await tx.activityLog.create({ data: { userId: old.userId, action: 'LOGOUT', entity: 'USER', entityId: old.userId, locationId: old.activeLocationId ?? old.user.locationId, details: { reason: 'Switched cashier on register', registerId: device.id } } });
      });
    }
  }
  await prisma.registerDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
  // The session works in the register's store, whichever store is the person's home.
  await completeSignIn(req, res, user, { method: 'PIN', registerId: device.id, registerName: device.name }, device.locationId);
});
