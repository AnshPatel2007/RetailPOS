import prisma from '../config/database';
import { AuthRequest } from '../types';
import { blindCloseEnabled } from '../validators/storeSettings.validator';

/**
 * True when the caller is a cashier in a store with blind close on: until the
 * drawer is counted and closed, nothing tells them what it should hold (the
 * expected amount, cash sales, cash refunds or today's cash total). Managers
 * and owners always see those figures.
 */
export async function cashierCountsBlind(req: AuthRequest): Promise<boolean> {
  if (req.user?.role !== 'CASHIER' || !req.user.locationId) return false;
  const location = await prisma.location.findUnique({ where: { id: req.user.locationId }, select: { settings: true } });
  return blindCloseEnabled(location?.settings);
}
