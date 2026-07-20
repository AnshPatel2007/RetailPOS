import { Router } from 'express';
import * as customerController from '../controllers/customer.controller';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createCustomerSchema, updateCustomerSchema } from '../validators/customer.validator';

const router = Router();

/**
 * All routes require authentication
 */
router.use(authenticate);

/**
 * Customer CRUD routes
 */
router.get('/search/phone', customerController.searchByPhone);
router.get('/', customerController.getCustomers);

/**
 * Email campaigns (segment blast) — admin only
 */
router.get(
  '/campaign/preview',
  authorize('ADMIN'),
  customerController.previewCampaignSegment
);
router.post(
  '/campaign',
  authorize('ADMIN'),
  customerController.sendCustomerCampaign
);

router.get('/:id', customerController.getCustomer);
router.get('/:id/history', customerController.getCustomerHistory);

router.post('/', validate(createCustomerSchema), customerController.createCustomer);

router.put('/:id', validate(updateCustomerSchema), customerController.updateCustomer);

router.delete('/:id', authorize('ADMIN', 'MANAGER'), customerController.deleteCustomer);

export default router;
