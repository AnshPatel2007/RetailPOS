import { Router } from 'express';
import * as pulseController from '../controllers/pulse.controller';
import { authenticate, authorize } from '../middleware/auth';

/** Phone alerts and Store Pulse (controllers/pulse.controller.ts). */
const router = Router();
router.use(authenticate);

router.get('/settings', authorize('ADMIN', 'MANAGER'), pulseController.getPulseSettings);
router.put('/settings', authorize('ADMIN'), pulseController.updatePulseSettings);
router.post('/push/subscribe', authorize('ADMIN', 'MANAGER'), pulseController.subscribePush);
// Anyone signed in may take their own device off (signing out does).
router.delete('/push/subscribe', pulseController.unsubscribePush);
router.post('/push/test', authorize('ADMIN', 'MANAGER'), pulseController.testPush);
// Store Pulse. Any signed-in person on a register computer reports in.
router.post('/heartbeat', pulseController.registerHeartbeat);
router.get('/status', authorize('ADMIN', 'MANAGER'), pulseController.getPulseStatus);
router.post('/closed-today', authorize('ADMIN', 'MANAGER'), pulseController.markClosedToday);

export default router;
