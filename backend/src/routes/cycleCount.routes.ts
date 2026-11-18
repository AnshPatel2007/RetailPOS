import { Router } from 'express';
import * as cycleCountController from '../controllers/cycleCount.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', cycleCountController.getCycleCounts);
// Above /:id so these names are not read as count ids.
router.get('/suggested', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), cycleCountController.getSuggestedCounts);
router.get('/accuracy', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), cycleCountController.getStockAccuracy);
router.get('/:id', cycleCountController.getCycleCount);
router.post('/', authorize('ADMIN', 'MANAGER'), cycleCountController.createCycleCount);
router.put('/:id/items', authorize('ADMIN', 'MANAGER'), cycleCountController.updateCountItems);
router.post('/:id/submit', authorize('ADMIN', 'MANAGER'), cycleCountController.submitForReview);
router.post('/:id/refresh', authorize('ADMIN', 'MANAGER'), cycleCountController.refreshCountItems);
router.post('/:id/approve', authorize('ADMIN'), cycleCountController.approveCycleCount);
router.post('/:id/cancel', authorize('ADMIN', 'MANAGER'), cycleCountController.cancelCycleCount);

export default router;
