import { Router } from 'express';
import { assistantHelp } from '../controllers/assistant.controller';
import { publicAssistantLimiter } from '../services/assistant.service';

const router = Router();
router.post('/help', publicAssistantLimiter, assistantHelp);
export default router;
