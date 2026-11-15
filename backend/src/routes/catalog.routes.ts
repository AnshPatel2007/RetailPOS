import { Response, Router } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { asyncHandler } from '../utils/errorHandler';
import { applyLinks, createFromProduct, listCatalog, previewLinks } from '../services/sharedCatalog.service';

/**
 * Shared catalog (services/sharedCatalog.service.ts): one list of items an owner
 * manages for all stores of the business. Every handler checks that the person
 * owns the business of the store they are working in.
 */
const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await listCatalog(req) })));
router.post('/link/preview', asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await previewLinks(req) })));
router.post('/link/apply', asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, ...(await applyLinks(req)) })));
router.post('/from-product', asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await createFromProduct(req) })));

export default router;
