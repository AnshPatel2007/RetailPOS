import { Router } from 'express';
import * as transferController from '../controllers/inventoryTransfer.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/options', transferController.getTransferOptions);
router.get('/connections', authorize('SUPER_ADMIN'), transferController.getConnections);
router.post('/connections', authorize('SUPER_ADMIN'), transferController.createConnection);
router.delete('/connections/:id', authorize('SUPER_ADMIN'), transferController.deleteConnection);
router.get('/', transferController.getTransfers);
router.get('/:id', transferController.getTransfer);
router.get('/:id/mapping-options', transferController.getTransferMappingOptions);
router.get('/:id/receipts', transferController.getTransferReceipts);
router.post('/', authorize('ADMIN', 'MANAGER'), transferController.createTransfer);
router.post('/:id/ship', authorize('ADMIN', 'MANAGER'), transferController.shipTransfer);
router.post('/:id/receive', authorize('ADMIN', 'MANAGER'), transferController.receiveTransfer);
router.post('/:id/receive-return', authorize('ADMIN', 'MANAGER'), transferController.receiveTransferReturn);
router.post('/:id/request-return', authorize('ADMIN', 'MANAGER'), transferController.requestTransferReturn);
router.post('/:id/cancel', authorize('ADMIN', 'MANAGER'), transferController.cancelTransfer);

export default router;
