import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as organization from '../controllers/organization.controller';

/**
 * Owners of more than one store: the My Stores overview, and giving their staff
 * access to their other stores. Each handler checks ownership of the store involved.
 */
export const organizationRoutes = Router();
organizationRoutes.use(authenticate);
organizationRoutes.get('/overview', organization.getOverview);
organizationRoutes.get('/access', organization.listAccess);
organizationRoutes.post('/access', organization.grantAccess);
organizationRoutes.delete('/access/:id', organization.removeAccess);

/** Platform admin: businesses, their owners (moving a store is PUT /api/locations/:id). */
export const organizationAdminRoutes = Router();
organizationAdminRoutes.use(authenticate, authorize('SUPER_ADMIN'));
organizationAdminRoutes.get('/', organization.listOrganizations);
organizationAdminRoutes.post('/', organization.createOrganization);
organizationAdminRoutes.post('/:id/owners', organization.addOrganizationOwner);
organizationAdminRoutes.delete('/:id/owners/:userId', organization.removeOrganizationOwner);
