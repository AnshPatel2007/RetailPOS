import { Router } from 'express';
import * as categoryController from '../controllers/category.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

/**
 * All routes require authentication
 */
router.use(authenticate);

/**
 * Category CRUD routes
 */
router.get('/', categoryController.getCategories);
router.get('/:id', categoryController.getCategory);
router.post('/', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), categoryController.createCategory);
router.put('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), categoryController.updateCategory);
router.delete('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), categoryController.deleteCategory);

export default router;