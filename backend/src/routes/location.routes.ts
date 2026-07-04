import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  getAllLocations,
  getLocationById,
  createLocation,
  updateLocation,
  deleteLocation,
  getLocationStats,
  getCrossLocationStats,
  getMyStoreSettings,
  updateMyStoreSettings,
} from '../controllers/location.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Store settings — readable by all authenticated users, writable by ADMIN/MANAGER/SUPER_ADMIN
router.get('/my-settings', getMyStoreSettings);
router.put('/my-settings', authorize('ADMIN', 'MANAGER'), updateMyStoreSettings);

// Any authenticated user can read a location (needed for POS tax rate)
router.get('/:id', getLocationById);

// Below routes require SUPER_ADMIN
router.use(authorize('SUPER_ADMIN'));

// Cross-location stats (dashboard)
router.get('/stats/overview', getCrossLocationStats);

// CRUD operations
router.get('/', getAllLocations);
router.get('/:id/stats', getLocationStats);
router.post('/', createLocation);
router.put('/:id', updateLocation);
router.delete('/:id', deleteLocation);

export default router;
