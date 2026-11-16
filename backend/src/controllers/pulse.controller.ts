/**
 * Phone alerts (routes/pulse.routes.ts): turning alerts on and off on a device, a
 * test alert, and the owner's alert amounts. Owners and managers may turn alerts on;
 * only owners see or change the amounts (a cashier or manager must not learn them).
 */
import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import { pushPublicKey, sendToDevices, storeAlertSettings } from '../services/storeAlert.service';

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
const settingsSchema = z.object({ refundAlertOver: money(100000).nullable().optional(), drawerAlertOver: money(10000).nullable().optional() })
  .strict().refine(body => Object.keys(body).length > 0, 'Choose something to change');

/** GET /api/pulse/settings: whether phone alerts work here, this person's devices, and (owners) the amounts. */
export const getPulseSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = ownStore(req);
  const devices = await prisma.pushSubscription.findMany({ where: { userId: req.user!.id }, select: { id: true, endpoint: true, deviceLabel: true, createdAt: true, lastSentAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  res.json({ success: true, data: { publicKey: pushPublicKey(), devices,
    ...(req.user!.role === 'ADMIN' ? { amounts: await storeAlertSettings(locationId) } : {}) } });
});

/** PUT /api/pulse/settings (owners): the refund and drawer amounts that send an alert; null turns one off. */
export const updatePulseSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = ownStore(req), input = settingsSchema.parse(req.body);
  await prisma.storeAlertSetting.upsert({ where: { locationId }, create: { locationId, ...input, updatedById: req.user!.id }, update: { ...input, updatedById: req.user!.id } });
  res.json({ success: true, data: { amounts: await storeAlertSettings(locationId) } });
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
