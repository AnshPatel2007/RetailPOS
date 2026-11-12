import { Router } from 'express';
import * as supplierController from '../controllers/supplier.controller';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createSupplierSchema,
  updateSupplierSchema,
  linkProductSchema,
  updateProductLinkSchema,
} from '../validators/supplier.validator';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ==========================================
// SUPPLIER ROUTES
// ==========================================

/**
 * Get all suppliers
 */
router.get('/', supplierController.getSuppliers);

/**
 * Credits suppliers owe the store (above /:id so "credits" is not read as an id)
 */
router.get('/credits', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), supplierController.listCredits);
router.post('/credits', authorize('ADMIN', 'MANAGER'), supplierController.createCredit);
router.post('/credits/:id/settle', authorize('ADMIN', 'MANAGER'), supplierController.settleCredit);

/**
 * Get supplier by ID
 */
router.get('/:id', supplierController.getSupplier);

/**
 * Get supplier performance metrics
 */
router.get('/:id/performance', supplierController.getSupplierPerformance);

/**
 * Create supplier (Admin/Manager only)
 */
router.post(
  '/',
  authorize('ADMIN', 'MANAGER'),
  validate(createSupplierSchema),
  supplierController.createSupplier
);

/**
 * Update supplier (Admin/Manager only)
 */
router.put(
  '/:id',
  authorize('ADMIN', 'MANAGER'),
  validate(updateSupplierSchema),
  supplierController.updateSupplier
);

/**
 * Delete supplier (Admin only)
 */
router.delete(
  '/:id',
  authorize('ADMIN'),
  supplierController.deleteSupplier
);

/**
 * Link product to supplier
 */
router.post(
  '/:id/products',
  authorize('ADMIN', 'MANAGER'),
  validate(linkProductSchema),
  supplierController.linkProduct
);

/**
 * Update product-supplier link
 */
router.put(
  '/:id/products/:productId',
  authorize('ADMIN', 'MANAGER'),
  validate(updateProductLinkSchema),
  supplierController.updateProductLink
);

/**
 * Unlink product from supplier
 */
router.delete(
  '/:id/products/:productId',
  authorize('ADMIN', 'MANAGER'),
  supplierController.unlinkProduct
);

export default router;