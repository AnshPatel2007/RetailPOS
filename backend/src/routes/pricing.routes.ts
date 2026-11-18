import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as pricing from '../controllers/pricing.controller';

const router = Router();
router.use(authenticate);

// Target margins and suggested prices. Cost and margin never appear at checkout.
router.get('/rules', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), pricing.listRules);
router.put('/rules', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), pricing.saveRule);
router.delete('/rules/:id', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), pricing.deleteRule);
router.get('/suggest', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), pricing.suggest);
router.get('/review', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), pricing.getPriceReview);
router.post('/apply', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), pricing.applyPrices);

export default router;
