import { Router } from 'express';
import { previewInventoryImport, applyInventoryImport } from '../services/inventoryImport.service';
import { asyncHandler } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import * as productController from '../controllers/product.controller';
import { identifyProduct, productIdentifyLimiter } from '../controllers/productIdentify.controller';
import { getInventoryHistory } from '../controllers/inventoryHistory.controller';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createProductSchema, updateProductSchema } from '../validators/product.validator';
import { upload } from '../middleware/upload';

const router = Router();

/**
 * All routes require authentication
 */
router.use(authenticate);

/**
 * Static routes MUST come before /:id to avoid being caught by the param route
 */
router.post('/imports/csv/preview', authorize('ADMIN', 'MANAGER'), asyncHandler(async (req: AuthRequest, res: import('express').Response) => res.json({ success: true, data: await previewInventoryImport(req, 'CSV') })));
router.post('/imports/receipt/preview', authorize('ADMIN', 'MANAGER'), asyncHandler(async (req: AuthRequest, res: import('express').Response) => res.json({ success: true, data: await previewInventoryImport(req, 'RECEIPT') })));
router.post('/imports/:id/apply', authorize('ADMIN', 'MANAGER'), asyncHandler(async (req: AuthRequest, res: import('express').Response) => res.json({ success: true, data: await applyInventoryImport(req) })));
router.get('/low-stock', productController.getLowStockProducts);
router.get('/movements', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), getInventoryHistory);
router.get('/stats', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), productController.getProductStats);

router.post(
  '/scan-receipt',
  authorize('ADMIN', 'MANAGER'),
  upload.single('receipt'),
  productController.scanReceipt
);

router.post(
  '/apply-receipt',
  authorize('ADMIN', 'MANAGER'),
  productController.applyReceipt
);

router.post(
  '/identify',
  authorize('ADMIN', 'MANAGER'),
  productIdentifyLimiter,
  identifyProduct
);

router.post(
  '/bulk-update-stock',
  authorize('ADMIN', 'MANAGER'),
  productController.bulkUpdateStock
);

router.post(
  '/bulk-update-price',
  authorize('ADMIN', 'MANAGER'),
  productController.bulkUpdatePrice
);

router.post(
  '/bulk-update-category',
  authorize('ADMIN', 'MANAGER'),
  productController.bulkUpdateCategory
);

router.post(
  '/bulk-toggle-active',
  authorize('ADMIN', 'MANAGER'),
  productController.bulkToggleActive
);

/**
 * Parameterized routes (must be after all static routes)
 */
router.get('/', productController.getProducts);
router.get('/:id', productController.getProduct);

router.post(
  '/',
  authorize('ADMIN', 'MANAGER'),
  validate(createProductSchema),
  productController.createProduct
);

router.put(
  '/:id',
  authorize('ADMIN', 'MANAGER'),
  validate(updateProductSchema),
  productController.updateProduct
);

router.delete(
  '/:id',
  authorize('ADMIN', 'MANAGER'),
  productController.deleteProduct
);

router.post(
  '/:id/adjust-inventory',
  authorize('ADMIN', 'MANAGER'),
  productController.adjustInventory
);

export default router;
