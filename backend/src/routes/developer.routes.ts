import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as developerController from '../controllers/developer.controller';

const router = Router();

router.use(authenticate);
router.use(authorize('ADMIN')); // developer settings are admin-only

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
