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
  '/employee-sales',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.getEmployeeSalesBreakdown
);

router.get(
  '/overall',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.getOverallReport
);

router.get(
  '/sales',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.getSalesReport
);

router.get(
  '/sales/export/csv',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.exportSalesCSV
);

router.get(
  '/sales/export/pdf',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.exportSalesPDF
);

router.get(
  '/inventory',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.getInventoryReport
);

router.get(
  '/inventory/export/csv',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.exportInventoryCSV
);

router.get(
  '/inventory/export/pdf',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.exportInventoryPDF
);

router.get(
  '/employees',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.getEmployeeReport
);

router.get(
  '/products',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.getProductSalesReport
);

router.get(
  '/expenses',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.getExpenseReport
);

router.get(
  '/stock-health',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.getStockHealthReport
);

// What needs the owner's attention today (Dashboard and the morning brief share it).
router.get('/attention', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), reportController.getAttention);

// "Send brief now": the address predates the morning brief and is kept for saved requests.
router.post(
  '/daily-digest/send',
  authorize('ADMIN'),
  reportController.sendOwnerBriefNow
);

router.get(
  '/age-verifications',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.getAgeVerifications
);

router.get(
  '/scan-data/export/csv',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  reportController.exportScanDataCSV
);

router.get('/daily-digest/deliveries', authorize('ADMIN'), reportController.listDigestDeliveries);
router.post('/daily-digest/deliveries/:id/retry', authorize('ADMIN'), reportController.retryDigestDelivery);

export default router;
