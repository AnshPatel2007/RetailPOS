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
import * as sellingUnitController from '../controllers/sellingUnit.controller';
import * as bundleController from '../controllers/productBundle.controller';

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

// Connected packaging: packs (e.g. a 12-pack) that share this product's stock.
router.get('/:id/selling-units', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), sellingUnitController.getPackaging);
router.post('/:id/selling-units', authorize('ADMIN', 'MANAGER'), sellingUnitController.createSellingUnit);
router.patch('/:id/selling-units', authorize('ADMIN', 'MANAGER'), sellingUnitController.updateBaseUnitName);
router.put('/:id/selling-units/:unitId', authorize('ADMIN', 'MANAGER'), sellingUnitController.updateSellingUnit);
router.post('/:id/selling-units/:unitId/packaging', authorize('ADMIN', 'MANAGER'), sellingUnitController.changePackaging);
// Variety packs: contents, and opening packs into them.
router.get('/:id/bundle', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), bundleController.getBundleContents);
router.put('/:id/bundle', authorize('ADMIN', 'MANAGER'), bundleController.updateBundleContents);
router.post('/:id/open-bundle', authorize('ADMIN', 'MANAGER'), bundleController.openBundlePacks);

router.post(
  '/:id/adjust-inventory',
  authorize('ADMIN', 'MANAGER'),
  productController.adjustInventory
);

export default router;
