import { Response, Router } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { asyncHandler } from '../utils/errorHandler';
import { applyLinks, createFromProduct, getCatalogItem, listCatalog, previewLinks } from '../services/sharedCatalog.service';
import {
  addCatalogPack, linkProduct, publishItem, publishMany, setCatalogPackPrice, setCatalogPrice, unlinkProduct, updateCatalogItem, updateCatalogPack,
} from '../services/sharedCatalogEdit.service';

/**
 * Shared catalog (services/sharedCatalog*.service.ts): one list of items an owner
 * manages for all stores of the business. Every handler checks that the person
 * owns the business of the store they are working in.
 */
const router = Router();
router.use(authenticate);

const send = (work: (req: AuthRequest) => Promise<unknown>) => asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await work(req) }));

router.get('/', send(listCatalog));
// Linking existing products (WP 5.1).
router.post('/link/preview', send(previewLinks));
router.post('/link/apply', asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, ...(await applyLinks(req)) })));
router.post('/from-product', send(createFromProduct));
// Adding many items to a store, and the shared packs (WP 5.2). Static paths before /:id.
router.post('/publish', send(publishMany));
router.put('/packs/:packId/price', send(setCatalogPackPrice));
router.put('/packs/:packId', send(updateCatalogPack));
router.get('/:id', send(getCatalogItem));
router.put('/:id', send(updateCatalogItem));
router.put('/:id/price', send(setCatalogPrice));
router.post('/:id/publish', send(publishItem));
router.post('/:id/link', send(linkProduct));
router.post('/:id/unlink', send(unlinkProduct));
router.post('/:id/packs', send(addCatalogPack));

export default router;
