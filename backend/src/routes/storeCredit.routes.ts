import { Router } from 'express';
import * as storeCreditController from '../controllers/storeCredit.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/:customerId', storeCreditController.getBalance);
router.post('/:customerId/credit', authorize('ADMIN', 'MANAGER'), storeCreditController.addCredit);
router.post('/:customerId/debit', storeCreditController.debitCredit);

export default router;
