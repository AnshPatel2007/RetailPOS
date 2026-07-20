import { Router } from 'express';
import * as houseAccountController from '../controllers/houseAccount.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);
// Managing credit accounts is manager+ across the board
router.use(authorize('ADMIN', 'MANAGER'));

router.get('/', houseAccountController.getHouseAccounts);
router.post('/', houseAccountController.createHouseAccount);
router.put('/:id', houseAccountController.updateHouseAccount);
router.post('/:id/payment', houseAccountController.recordHousePayment);
router.get('/:id/transactions', houseAccountController.getHouseTransactions);
router.post('/:id/statement', houseAccountController.emailHouseStatement);

export default router;
