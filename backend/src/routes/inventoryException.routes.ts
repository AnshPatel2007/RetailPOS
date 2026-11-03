import { Router } from 'express';
import * as controller from '../controllers/inventoryException.controller';
import { authenticate, requireCapability } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', controller.listExceptions);
router.get('/summary', controller.exceptionSummary);
router.get('/:id', controller.getException);
router.post('/:id/recount', requireCapability('inventory.manage'), controller.requestRecount);
router.post('/:id/count', requireCapability('inventory.manage'), controller.recordCount);
router.post('/:id/resolve', requireCapability('inventory.manage'), controller.resolve);

export default router;
