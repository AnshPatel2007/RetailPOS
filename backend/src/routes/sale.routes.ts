import { Router } from 'express';
import * as saleController from '../controllers/sale.controller';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createSaleSchema, refundSaleSchema } from '../validators/sale.validator';

const router = Router();

/**
 * All routes require authentication
 */
router.use(authenticate);

/**
 * Sale routes
 */
router.get('/', saleController.getSales);
router.get('/:id', saleController.getSale);

router.post('/', validate(createSaleSchema), saleController.createSale);

router.post(
  '/:id/refund',
  authorize('ADMIN', 'MANAGER'),
  validate(refundSaleSchema),
  saleController.refundSale
);

router.post(
  '/:id/void',
  authorize('ADMIN', 'MANAGER'),
  saleController.voidSale
);

router.post('/:id/email-receipt', saleController.emailReceipt);

router.post(
  '/bulk-void',
  authorize('ADMIN', 'MANAGER'),
  saleController.bulkVoidSales
);

router.post(
  '/bulk-refund',
  authorize('ADMIN', 'MANAGER'),
  saleController.bulkRefundSales
);

export default router;
