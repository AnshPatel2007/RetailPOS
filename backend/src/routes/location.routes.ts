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
} from '../controllers/location.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

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
