import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { AuthRequest } from '../types';
import { asyncHandler } from '../utils/errorHandler';
import prisma from '../config/database';
import { reconcileOfflineCheckout } from '../services/offlineReconciliation.service';
const router = Router();
router.use(authenticate, authorize('ADMIN', 'MANAGER'));
router.post('/reconcile', asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, ...await reconcileOfflineCheckout(req) })));
router.get('/history', asyncHandler(async (req: AuthRequest, res: Response) => {
  const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page || 1);
  const where = { locationId: req.user!.locationId!, kind: 'OFFLINE_RECONCILIATION' };
  const [records, total] = await prisma.$transaction([
    prisma.operationReceipt.findMany({ where, select: { id: true, createdAt: true, result: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 50, take: 50 }),
    prisma.operationReceipt.count({ where }),
  ]);
  res.json({ success: true, data: { records, pagination: { page, total, totalPages: Math.ceil(total / 50) } } });
}));
export default router;
