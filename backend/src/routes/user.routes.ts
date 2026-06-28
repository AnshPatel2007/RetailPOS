import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  getAllUsers,
  createUser,
  getUserById,
  updateUser,
  resetUserPassword,
  deleteUser,
  getUserPerformance,
  getProfile,
  updateProfile,
  changePassword,
} from '../controllers/user.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Current user profile routes (no authorization needed - all authenticated users)
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.post('/change-password', changePassword);

// Get all users (admins see their location, super-admin sees all)
router.get('/', authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), getAllUsers);

// Create new user (admin/super-admin only)
router.post('/', authorize('ADMIN', 'SUPER_ADMIN'), createUser);

// Get user by ID
router.get('/:id', authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), getUserById);

// Get user performance stats
router.get('/:id/performance', authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), getUserPerformance);

// Update user (admin/super-admin only)
router.put('/:id', authorize('ADMIN', 'SUPER_ADMIN'), updateUser);

// Reset user password (admin/super-admin only)
router.post('/:id/reset-password', authorize('ADMIN', 'SUPER_ADMIN'), resetUserPassword);

// Delete user (admin/super-admin only)
router.delete('/:id', authorize('ADMIN', 'SUPER_ADMIN'), deleteUser);

export default router;
