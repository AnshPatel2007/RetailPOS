import { Router } from 'express';
import * as reportController from '../controllers/report.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

/**
 * All routes require authentication
 * Most reports require manager/admin access
 */
router.use(authenticate);

/**
 * Report routes
 */
router.get('/dashboard', reportController.getDashboardMetrics);
router.get('/dashboard/hourly', reportController.getDashboardHourly);

router.get(
  '/overall',
  authorize('ADMIN', 'MANAGER'),
  reportController.getOverallReport
);

router.get(
  '/sales',
  authorize('ADMIN', 'MANAGER'),
  reportController.getSalesReport
);

router.get(
  '/sales/export/csv',
  authorize('ADMIN', 'MANAGER'),
  reportController.exportSalesCSV
);

router.get(
  '/sales/export/pdf',
  authorize('ADMIN', 'MANAGER'),
  reportController.exportSalesPDF
);

router.get(
  '/inventory',
  authorize('ADMIN', 'MANAGER'),
  reportController.getInventoryReport
);

router.get(
  '/inventory/export/csv',
  authorize('ADMIN', 'MANAGER'),
  reportController.exportInventoryCSV
);

router.get(
  '/inventory/export/pdf',
  authorize('ADMIN', 'MANAGER'),
  reportController.exportInventoryPDF
);

router.get(
  '/employees',
  authorize('ADMIN', 'MANAGER'),
  reportController.getEmployeeReport
);

router.get(
  '/products',
  authorize('ADMIN', 'MANAGER'),
  reportController.getProductSalesReport
);

router.get(
  '/expenses',
  authorize('ADMIN', 'MANAGER'),
  reportController.getExpenseReport
);

export default router;
