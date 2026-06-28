import { Router } from 'express';
import * as cycleCountController from '../controllers/cycleCount.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', cycleCountController.getCycleCounts);
router.get('/:id', cycleCountController.getCycleCount);
router.post('/', authorize('ADMIN', 'MANAGER'), cycleCountController.createCycleCount);
router.put('/:id/items', authorize('ADMIN', 'MANAGER'), cycleCountController.updateCountItems);
router.post('/:id/submit', authorize('ADMIN', 'MANAGER'), cycleCountController.submitForReview);
router.post('/:id/approve', authorize('ADMIN'), cycleCountController.approveCycleCount);
router.post('/:id/cancel', authorize('ADMIN', 'MANAGER'), cycleCountController.cancelCycleCount);

export default router;
