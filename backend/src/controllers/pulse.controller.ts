/**
 * Phone alerts and Store Pulse (routes/pulse.routes.ts): turning alerts on and off on
 * a device, a test alert, the owner's alert amounts and pulse switches, the store's
 * pulse (open since, last sale, open alerts), "closed today", and the register's
 * once-a-minute report. Owners and managers may turn alerts on; only owners see or
 * change the amounts (a cashier or manager must not learn them).
 */
import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import { pushPublicKey, sendToDevices, storeAlertSettings } from '../services/storeAlert.service';
import { pulseStatus, recordHeartbeat, resolvePulseKinds, setClosedToday } from '../services/storePulse.service';
import { PulseKind } from '../services/storePulse';
import { hashDeviceToken } from './registerPin.controller';

const ownStore = (req: AuthRequest) => {
  if (!req.user?.locationId) throw new AppError('A store assignment is required', 403);
  return req.user.locationId;
};
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000).refine(value => value.startsWith('https://'), 'Use the address the browser gave'),
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }).strict(),
  deviceLabel: z.string().trim().max(80).optional(),
}).strict();
const money = (max: number) => z.number().finite().min(0.01).max(max).refine(value => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, 'Use whole cents');
const switchesSchema = z.object({ notOpen: z.boolean(), quiet: z.boolean(), register: z.boolean(), leftOpen: z.boolean() }).partial().strict();
const settingsSchema = z.object({ refundAlertOver: money(100000).nullable().optional(), drawerAlertOver: money(10000).nullable().optional(), pulse: switchesSchema.optional() })
  .strict().refine(body => Object.keys(body).length > 0, 'Choose something to change');

/** What only owners see: the alert amounts and which Store Pulse alerts are on. */
async function ownerView(locationId: string) {
  const [amounts, row] = await Promise.all([storeAlertSettings(locationId),
    prisma.storeAlertSetting.findUnique({ where: { locationId }, select: { pulseNotOpen: true, pulseQuiet: true, pulseRegister: true, pulseLeftOpen: true } })]);
  return { amounts, pulse: { notOpen: row?.pulseNotOpen ?? true, quiet: row?.pulseQuiet ?? true, register: row?.pulseRegister ?? true, leftOpen: row?.pulseLeftOpen ?? true } };
}

/** GET /api/pulse/settings: whether phone alerts work here, this person's devices, and (owners) the amounts. */
export const getPulseSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = ownStore(req);
  const devices = await prisma.pushSubscription.findMany({ where: { userId: req.user!.id }, select: { id: true, endpoint: true, deviceLabel: true, createdAt: true, lastSentAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  res.json({ success: true, data: { publicKey: pushPublicKey(), devices,
    ...(req.user!.role === 'ADMIN' ? await ownerView(locationId) : {}) } });
});

/** PUT /api/pulse/settings (owners): the refund and drawer amounts that send an alert (null turns one off), and the pulse switches. */
export const updatePulseSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = ownStore(req), { pulse, ...amounts } = settingsSchema.parse(req.body);
  const data = { ...amounts, ...(pulse ? { pulseNotOpen: pulse.notOpen, pulseQuiet: pulse.quiet, pulseRegister: pulse.register, pulseLeftOpen: pulse.leftOpen } : {}), updatedById: req.user!.id };
  await prisma.storeAlertSetting.upsert({ where: { locationId }, create: { locationId, ...data }, update: data });
  // A switched-off alert closes at once.
  const switchedOff = pulse ? ([['PULSE_NOT_OPEN', pulse.notOpen], ['PULSE_QUIET', pulse.quiet], ['PULSE_REGISTER', pulse.register], ['PULSE_LEFT_OPEN', pulse.leftOpen]] as [PulseKind, boolean | undefined][])
    .filter(([, on]) => on === false).map(([kind]) => kind) : [];
  await resolvePulseKinds(locationId, switchedOff);
  res.json({ success: true, data: await ownerView(locationId) });
});

/** POST /api/pulse/heartbeat { deviceToken }: a register computer reports in (once a minute while someone is signed in on it). */
export const registerHeartbeat = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = ownStore(req);
  const { deviceToken } = z.object({ deviceToken: z.string().min(20).max(200) }).strict().parse(req.body);
  const device = await prisma.registerDevice.findUnique({ where: { tokenHash: hashDeviceToken(deviceToken) }, select: { id: true, locationId: true, revokedAt: true } });
  if (!device || device.revokedAt || device.locationId !== locationId) throw new AppError('This computer is not set up as a register for this store.', 404);
  if (!req.sessionId) throw new AppError('This session must be renewed. Sign in again if renewal fails.', 401);
  res.json({ success: true, data: { recorded: await recordHeartbeat(device.id, req.user!.id, req.sessionId) } });
});

/** GET /api/pulse/status: open since, the last sale, the usual hours today and the open pulse alerts. */
export const getPulseStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = ownStore(req);
  const store = await prisma.location.findUnique({ where: { id: locationId }, select: { timezone: true } });
  res.json({ success: true, data: await pulseStatus(locationId, store?.timezone || 'UTC') });
});

/** POST /api/pulse/closed-today { closed }: no opening or quiet-register alerts for the rest of the store day (holidays). */
export const markClosedToday = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = ownStore(req), { closed } = z.object({ closed: z.boolean() }).strict().parse(req.body);
  res.json({ success: true, data: { closedDay: await setClosedToday(locationId, req.user!.id, closed) } });
});

/** POST /api/pulse/push/subscribe: this device gets this person's alerts (a device moves to whoever turns it on last). */
export const subscribePush = asyncHandler(async (req: AuthRequest, res: Response) => {
  ownStore(req);
  if (!pushPublicKey()) throw new AppError('Phone alerts are not set up on this server yet.', 409);
  const input = subscriptionSchema.parse(req.body);
  if (await prisma.pushSubscription.count({ where: { userId: req.user!.id, NOT: { endpoint: input.endpoint } } }) >= 10) throw new AppError('Alerts are on for 10 devices already. Turn them off on one first.', 409);
  const data = { userId: req.user!.id, p256dh: input.keys.p256dh, auth: input.keys.auth, deviceLabel: input.deviceLabel || null };
  const device = await prisma.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data });
  res.status(201).json({ success: true, data: { id: device.id } });
});

/** DELETE /api/pulse/push/subscribe { endpoint }: this device stops getting this person's alerts. */
export const unsubscribePush = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { endpoint } = z.object({ endpoint: z.string().max(2000) }).strict().parse(req.body);
  const removed = await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user!.id } });
  res.json({ success: true, data: { removed: removed.count } });
});

/** POST /api/pulse/push/test: a test alert to each of this person's devices. */
export const testPush = asyncHandler(async (req: AuthRequest, res: Response) => {
  ownStore(req);
  if (!pushPublicKey()) throw new AppError('Phone alerts are not set up on this server yet.', 409);
  const devices = await prisma.pushSubscription.findMany({ where: { userId: req.user!.id }, select: { id: true, endpoint: true, p256dh: true, auth: true } });
  if (!devices.length) throw new AppError('Turn alerts on for this device first.', 409);
  const sent = await sendToDevices(devices, { title: 'Test alert', body: 'Alerts reach this device. Real ones say what happened and open the page that deals with it.', tag: 'test', url: '/dashboard' });
  res.json({ success: true, data: { devices: devices.length, sent } });
});
