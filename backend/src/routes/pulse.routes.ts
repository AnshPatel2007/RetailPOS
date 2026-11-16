import { Router } from 'express';
import * as pulseController from '../controllers/pulse.controller';
import { authenticate, authorize } from '../middleware/auth';

/** Phone alerts (controllers/pulse.controller.ts). */
const router = Router();
router.use(authenticate);

router.get('/settings', authorize('ADMIN', 'MANAGER'), pulseController.getPulseSettings);
router.put('/settings', authorize('ADMIN'), pulseController.updatePulseSettings);
router.post('/push/subscribe', authorize('ADMIN', 'MANAGER'), pulseController.subscribePush);
// Anyone signed in may take their own device off (signing out does).
router.delete('/push/subscribe', pulseController.unsubscribePush);
router.post('/push/test', authorize('ADMIN', 'MANAGER'), pulseController.testPush);

export default router;
