import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as developerController from '../controllers/developer.controller';

const router = Router();

router.use(authenticate);
// API keys/webhooks have no per-location scoping and read/emit chain-wide
// data (see publicApi.controller.ts) — restricted to the chain owner only,
// not per-store admins.
router.use(authorize('SUPER_ADMIN'));

// API keys
router.get('/api-keys', developerController.listApiKeys);
router.post('/api-keys', developerController.createApiKey);
router.delete('/api-keys/:id', developerController.revokeApiKey);

// Webhooks
router.get('/webhooks', developerController.listWebhooks);
router.post('/webhooks', developerController.createWebhook);
router.put('/webhooks/:id', developerController.updateWebhook);
router.delete('/webhooks/:id', developerController.deleteWebhook);
router.post('/webhooks/:id/test', developerController.testWebhook);

export default router;
