import { Router } from 'express';
import * as productController from '../controllers/product.controller';
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
 * Product CRUD routes
 */
router.get('/', productController.getProducts);
router.get('/low-stock', productController.getLowStockProducts);
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

// Receipt scanning routes (must be before /:id routes)
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

export default router;
