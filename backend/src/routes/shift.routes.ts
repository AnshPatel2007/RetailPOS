import { Router } from 'express';
import * as shiftController from '../controllers/shift.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

/**
 * All routes require authentication
 */
router.use(authenticate);

/**
 * Shift routes
 */
router.get('/', shiftController.getShifts);
router.get('/current', shiftController.getCurrentShift);
router.get(
  '/employee-performance',
  authorize('ADMIN', 'MANAGER'),
  shiftController.getEmployeePerformance
);

router.post('/clock-in', shiftController.clockIn);
router.post('/clock-out', shiftController.clockOut);
router.post('/cash-movement', shiftController.recordCashMovement);
router.get('/:id/z-report', shiftController.getShiftZReport);

router.post(
  '/:id/close',
  authorize('ADMIN', 'MANAGER'),
  shiftController.closeShift
);

export default router;
