import { Router } from 'express';
import * as promotionController from '../controllers/promotion.controller';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createPromotionSchema, updatePromotionSchema } from '../validators/promotion.validator';

const router = Router();

router.use(authenticate);

// Any signed-in register needs the active list for cart previews
router.get('/active', promotionController.getActivePromotions);

// Managing promotions is manager+
router.get('/', authorize('ADMIN', 'MANAGER'), promotionController.getPromotions);
router.get('/:id', authorize('ADMIN', 'MANAGER'), promotionController.getPromotion);
router.post('/', authorize('ADMIN', 'MANAGER'), validate(createPromotionSchema), promotionController.createPromotion);
router.put('/:id', authorize('ADMIN', 'MANAGER'), validate(updatePromotionSchema), promotionController.updatePromotion);
router.post('/:id/toggle', authorize('ADMIN', 'MANAGER'), promotionController.togglePromotion);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), promotionController.deletePromotion);

export default router;
