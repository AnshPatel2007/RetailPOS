import { Router } from 'express';
import * as giftCardController from '../controllers/giftCard.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', giftCardController.getGiftCards);
router.get('/balance/:code', giftCardController.checkBalance);
router.get('/:idOrCode', giftCardController.getGiftCard);

router.post('/', authorize('ADMIN', 'MANAGER'), giftCardController.issueGiftCard);
router.post('/:id/reload', authorize('ADMIN', 'MANAGER'), giftCardController.reloadGiftCard);
router.post('/:idOrCode/redeem', giftCardController.redeemGiftCard);
router.post('/:id/deactivate', authorize('ADMIN', 'MANAGER'), giftCardController.deactivateGiftCard);

export default router;
