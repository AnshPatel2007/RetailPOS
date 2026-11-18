import { Router, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import prisma from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { can } from '../policies/capabilities';
import { approvalAction, approvalToken, discountApprovalHash, discountedLines, DISCOUNT_APPROVAL_MINUTES, DISCOUNT_APPROVAL_PATH, hashToken, requestHash } from '../services/managerApproval.service';
import { verifyTOTPCode } from '../controllers/twoFactor.controller';
import { roleAtStore } from '../services/organization.service';

const router = Router();
const schema = z.object({ email: z.string().email(), password: z.string().min(1).max(200), twoFactorCode: z.string().optional(), reason: z.string().trim().min(1).max(500), request: z.object({ method: z.literal('POST'), path: z.string().max(300), body: z.record(z.unknown()) }) });
router.use(authenticate, authorize('CASHIER'));
router.use(rateLimit({ windowMs: 15 * 60_000, max: 10, keyGenerator: req => (req as AuthRequest).user!.id, skip: () => process.env.NODE_ENV === 'test' }));
router.post('/preview', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { request } = schema.pick({ request: true }).parse(req.body);
  const action = approvalAction(request.path, request.method);
  if (action === 'checkout.override') {
    const body = request.body as { expectedTotal?: number; items?: { productId: string; name?: string; price: number; quantity: number; discount?: number; priceOverride?: boolean }[] };
    const atRegister = request.path === DISCOUNT_APPROVAL_PATH;
    if (atRegister ? !discountedLines(body.items).length : (!Number.isFinite(body.expectedTotal) || !body.items?.length)) throw new AppError('Refresh checkout before requesting approval', 400);
    const products = await prisma.product.findMany({ where: { id: { in: body.items!.map(i => i.productId) }, locationId: req.user!.locationId } });
    const items = (atRegister ? body.items!.filter(item => Math.round(Number(item.discount || 0) * 100) > 0 || item.priceOverride === true) : body.items!).map(item => {
      const product = products.find(p => p.id === item.productId);
      if (!product && !item.productId.startsWith('misc-')) throw new AppError('Product not found at this store', 404);
      return { name: product?.name || item.name || 'Misc Item', quantity: item.quantity, price: Number(item.priceOverride || !product ? item.price : product.price), discount: item.discount || 0 };
    });
    const discountTotal = Math.round(items.reduce((sum, item) => sum + (item.discount || 0), 0) * 100) / 100;
    res.json({ success: true, data: atRegister
      ? { action: 'Discount or price change on this sale', amount: discountTotal, items }
      : { action: 'Checkout with discount or price change', amount: body.expectedTotal, items } });
    return;
  }
  const saleId = request.path.split('/')[3];
  const sale = await prisma.sale.findFirst({ where: { id: saleId, locationId: req.user!.locationId }, include: { items: true } });
  if (!sale) throw new AppError('Sale not found', 404);
  const body = request.body as { amount?: number; items?: { saleItemId: string; quantity: number }[] };
  const lines = body.items?.map(item => {
    const original = sale.items.find(i => i.id === item.saleItemId);
    if (!original) throw new AppError('Refund item not found', 400);
    return { name: original.productName, quantity: item.quantity, price: Number(original.total) / original.quantity, discount: 0 };
  }) || [];
  const amount = lines.length ? Math.round(lines.reduce((sum, line) => sum + line.price * line.quantity, 0) * 100) / 100 : body.amount ?? sale.total;
  res.json({ success: true, data: { action: `${request.path.endsWith('/void') ? 'Void' : 'Refund'} sale ${sale.saleNumber}`, amount, items: lines } });
}));
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = schema.parse(req.body);
  const action = approvalAction(body.request.path, body.request.method);
  const manager = await prisma.user.findUnique({ where: { email: body.email.trim().toLowerCase() } });
  // The approver must be able to approve in this store: their role here, home store or not.
  const managerRole = manager?.isActive && req.user!.locationId ? await roleAtStore(manager.id, req.user!.locationId) : null;
  const validManager = manager && managerRole && can(managerRole, action);
  if (!validManager || (manager.lockoutUntil && manager.lockoutUntil > new Date())) throw new AppError('Manager verification failed', 403);
  const passwordValid = await bcrypt.compare(body.password, manager.password);
  const secondFactorValid = passwordValid && (!manager.twoFactorEnabled || (!!body.twoFactorCode && await verifyTOTPCode(manager.id, body.twoFactorCode)));
  if (!secondFactorValid) {
    const updated = await prisma.user.update({ where: { id: manager.id }, data: { failedLoginAttempts: { increment: 1 } } });
    if (updated.failedLoginAttempts >= 5) await prisma.user.update({ where: { id: manager.id }, data: { lockoutUntil: new Date(Date.now() + 15 * 60_000) } });
    throw new AppError(manager.twoFactorEnabled && passwordValid ? 'Enter a valid manager authentication code' : 'Manager verification failed', 403);
  }
  // A register discount approval covers the discounted lines for one sale; other approvals cover one exact request.
  const atRegister = body.request.path === DISCOUNT_APPROVAL_PATH;
  if (atRegister && !discountedLines((body.request.body as { items?: unknown }).items).length) throw new AppError('There is no discount or price change to approve', 400);
  const token = approvalToken();
  await prisma.managerApproval.create({ data: { tokenHash: hashToken(token),
    requestHash: atRegister ? discountApprovalHash((body.request.body as { items?: unknown }).items) : requestHash(body.request.method, body.request.path, body.request.body),
    cashierId: req.user!.id, managerId: manager.id, locationId: req.user!.locationId!, action, reason: body.reason,
    expiresAt: new Date(Date.now() + (atRegister ? DISCOUNT_APPROVAL_MINUTES : 2) * 60_000) } });
  await prisma.user.update({ where: { id: manager.id }, data: { failedLoginAttempts: 0, lockoutUntil: null } });
  res.status(201).json({ success: true, data: { token, expiresIn: (atRegister ? DISCOUNT_APPROVAL_MINUTES : 2) * 60 } });
}));
export default router;
