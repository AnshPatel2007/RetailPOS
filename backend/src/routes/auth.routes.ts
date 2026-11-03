import { Router,Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import {asyncHandler} from '../utils/errorHandler';
import {z} from 'zod';
import { config } from '../config';
import * as authController from '../controllers/auth.controller';
import * as twoFactorController from '../controllers/twoFactor.controller';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  twoFactorVerifySchema,
  twoFactorDisableSchema
} from '../validators/auth.validator';

const router = Router();
// Refresh cookies can be cross-site in production. Require an allowed browser origin.
router.use(['/refresh', '/logout'], (req, res, next) => {
  const allowed = Array.isArray(config.cors.origin) ? config.cors.origin : [config.cors.origin];
  if (req.headers.origin && !allowed.includes(req.headers.origin)) {
    res.status(403).json({ success: false, error: 'Origin not allowed' });
    return;
  }
  next();
});

/**
 * Public routes
 */
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', authController.refreshAccessToken);
router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);

/**
 * Protected routes
 */
router.get('/me', authenticate, authController.getCurrentUser);
router.get('/security-notifications',authenticate,asyncHandler(async(req:AuthRequest,res:Response)=>{
  const actor=(req as AuthRequest).user!,page=z.coerce.number().int().min(1).max(100000).parse(req.query.page||1);
  const where={kind:'EMAIL',label:'ACCOUNT SECURITY',requestedBy:actor.id};
  const [records,total]=await prisma.$transaction([prisma.backgroundJob.findMany({where,select:{id:true,status:true,attempts:true,lastError:true,createdAt:true,finishedAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50,skip:(page-1)*50}),prisma.backgroundJob.count({where})]);
  res.json({success:true,data:{records,pagination:{page,total,totalPages:Math.ceil(total/50)}}});
}));
router.post('/logout', authController.logout);
router.post('/logout-all', authenticate, authController.logoutAll);
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);

// Session management
router.get('/sessions', authenticate, authController.getSessions);
router.delete('/sessions/:sessionId', authenticate, authController.revokeSession);

// Two-factor authentication
router.use('/2fa', authenticate, rateLimit({ windowMs: 15 * 60000, max: 10,
  keyGenerator: req => (req as AuthRequest).user!.id,
  skip: req => req.method === 'GET' || process.env.NODE_ENV === 'test' }));
router.get('/2fa/status', authenticate, twoFactorController.get2FAStatus);
router.post('/2fa/setup', authenticate, twoFactorController.setup2FA);
router.delete('/2fa/setup', authenticate, twoFactorController.cancel2FASetup);
router.post('/2fa/verify', authenticate, validate(twoFactorVerifySchema), twoFactorController.verify2FA);
router.post('/2fa/disable', authenticate, validate(twoFactorDisableSchema), twoFactorController.disable2FA);
router.post('/2fa/backup-codes', authenticate, twoFactorController.regenerateBackupCodes);

/**
 * Admin only routes
 */
router.post(
  '/register',
  authenticate,
  authorize('SUPER_ADMIN', 'ADMIN'),
  validate(registerSchema),
  authController.register
);

export default router;
