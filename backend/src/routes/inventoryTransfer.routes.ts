import { Router } from 'express';
import * as transferController from '../controllers/inventoryTransfer.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', transferController.getTransfers);
router.get('/:id', transferController.getTransfer);
router.post('/', authorize('ADMIN', 'MANAGER'), transferController.createTransfer);
router.post('/:id/ship', authorize('ADMIN', 'MANAGER'), transferController.shipTransfer);
router.post('/:id/receive', authorize('ADMIN', 'MANAGER'), transferController.receiveTransfer);
router.post('/:id/cancel', authorize('ADMIN', 'MANAGER'), transferController.cancelTransfer);

export default router;
