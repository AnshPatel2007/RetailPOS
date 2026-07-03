import { Router } from 'express';
import * as storeCreditController from '../controllers/storeCredit.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), storeCreditController.listAccounts);
router.get('/:customerId', storeCreditController.getBalance);
router.get('/:customerId/transactions', storeCreditController.getTransactions);
router.post('/:customerId/credit', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), storeCreditController.addCredit);
router.post('/:customerId/debit', storeCreditController.debitCredit);

export default router;
