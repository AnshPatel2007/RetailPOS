import { Router } from 'express';
import * as exchangeController from '../controllers/exchange.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', exchangeController.getExchanges);
router.get('/:id', exchangeController.getExchange);
router.post('/', authorize('ADMIN', 'MANAGER'), exchangeController.createExchange);

export default router;
