import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import prisma from '../config/database';
import { correctBalance, previewCorrection, reconcileLegacyVoid } from '../services/reconciliation.service';
const router = Router();
router.use(authenticate, authorize('ADMIN'));
// Keep the assigned-owner boundary explicit on every reconciliation read/write.
router.use((req: AuthRequest, _res, next) => {
  if (req.user?.role !== 'ADMIN' || !req.user.locationId) return next(new AppError('An assigned store owner must manage reconciliation', 403));
  next();
});
router.post('/corrections/preview', asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await previewCorrection(req) })));
router.post('/corrections', asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, ...await correctBalance(req) })));
router.post('/legacy-voids', asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, ...await reconcileLegacyVoid(req) })));
router.get('/receipts/:id',asyncHandler(async(req:AuthRequest,res:Response)=>{
  const receipt=await prisma.operationReceipt.findFirst({where:{id:req.params.id,locationId:req.user!.locationId!,kind:{in:['BALANCE_CORRECTION','LEGACY_VOID_RECONCILED','OFFLINE_RECONCILIATION']}},select:{id:true,kind:true,result:true,createdAt:true}});
  if(!receipt){res.status(404).json({success:false,error:'Reconciliation receipt not found'});return;}
  res.json({success:true,data:receipt.result});
}));
router.get('/legacy-voids', asyncHandler(async (req: AuthRequest, res: Response) => {
  const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page || 1);
  const where = { locationId: req.user!.locationId!, status: 'VOIDED' as const, voidEvent: { is: null } };
  const [sales, total] = await prisma.$transaction([
    prisma.sale.findMany({ where, select: { id: true, saleNumber: true, createdAt: true, total: true, paymentMethod: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, skip: (page - 1) * 50 }),
    prisma.sale.count({ where }),
  ]);
  res.json({ success: true, data: { sales, pagination: { page, limit: 50, total, totalPages: Math.ceil(total / 50) } } });
}));
router.get('/history', asyncHandler(async (req: AuthRequest, res: Response) => {
  const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page || 1);
  const where = { locationId: req.user!.locationId!, kind: { in: ['BALANCE_CORRECTION', 'LEGACY_VOID_RECONCILED', 'OFFLINE_RECONCILIATION'] } };
  const [records, total] = await prisma.$transaction([
    prisma.operationReceipt.findMany({ where, select: { id: true, kind: true, createdAt: true, result: true, user: { select: { firstName: true, lastName: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, skip: (page - 1) * 50 }),
    prisma.operationReceipt.count({ where }),
  ]);
  res.json({ success: true, data: { records, pagination: { page, limit: 50, total, totalPages: Math.ceil(total / 50) } } });
}));
export default router;
