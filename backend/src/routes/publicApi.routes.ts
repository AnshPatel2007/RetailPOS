import { Router } from 'express';
import { authenticateApiKey } from '../middleware/apiKeyAuth';
import * as publicApi from '../controllers/publicApi.controller';

/**
 * Public API v1 — read-only, API-key authenticated (X-API-Key header).
 * Mounted at /api/v1 (before the internal /api router).
 */
const router = Router();

router.use(authenticateApiKey);

router.get('/summary', publicApi.getSummary);
router.get('/products', publicApi.listProducts);
router.get('/products/:id', publicApi.getProduct);
router.get('/sales', publicApi.listSales);
router.get('/sales/:id', publicApi.getSale);
router.get('/customers', publicApi.listCustomers);

export default router;
