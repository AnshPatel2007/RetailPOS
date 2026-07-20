import { Router } from 'express';
import * as purchaseOrderController from '../controllers/purchaseOrder.controller';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  updateStatusSchema,
  receivePurchaseOrderSchema,
} from '../validators/supplier.validator';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * Get all purchase orders
 */
router.get('/', purchaseOrderController.getPurchaseOrders);

/**
 * Auto-generate purchase orders for low stock items
 */
router.post(
  '/auto-generate',
  authorize('ADMIN', 'MANAGER'),
  purchaseOrderController.autoGeneratePurchaseOrders
);

/**
 * Suggested purchase orders (velocity-based reorder plan)
 */
router.get(
  '/suggested',
  authorize('ADMIN', 'MANAGER'),
  purchaseOrderController.getSuggestedOrders
);

/**
 * Get purchase order by ID
 */
router.get('/:id', purchaseOrderController.getPurchaseOrder);

/**
 * Create purchase order
 */
router.post(
  '/',
  authorize('ADMIN', 'MANAGER'),
  validate(createPurchaseOrderSchema),
  purchaseOrderController.createPurchaseOrder
);

/**
 * Update purchase order
 */
router.put(
  '/:id',
  authorize('ADMIN', 'MANAGER'),
  validate(updatePurchaseOrderSchema),
  purchaseOrderController.updatePurchaseOrder
);

/**
 * Update purchase order status
 */
router.post(
  '/:id/status',
  authorize('ADMIN', 'MANAGER'),
  validate(updateStatusSchema),
  purchaseOrderController.updateStatus
);

/**
 * Receive purchase order (update inventory)
 */
router.post(
  '/:id/receive',
  authorize('ADMIN', 'MANAGER'),
  validate(receivePurchaseOrderSchema),
  purchaseOrderController.receivePurchaseOrder
);

/**
 * Cancel purchase order
 */
router.post(
  '/:id/cancel',
  authorize('ADMIN', 'MANAGER'),
  purchaseOrderController.cancelPurchaseOrder
);

/**
 * Delete purchase order
 */
router.delete(
  '/:id',
  authorize('ADMIN'),
  purchaseOrderController.deletePurchaseOrder
);

export default router;