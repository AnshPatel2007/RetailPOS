import { Router } from 'express';
import * as lotteryController from '../controllers/lottery.controller';
import * as lotteryDailyController from '../controllers/lotteryDaily.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * BATCH ROUTES
 */
router.get('/batches', lotteryController.getBatches);
router.get('/batches/:id', lotteryController.getBatchById);
router.post('/batches', lotteryController.createBatch);
router.put('/batches/:id', lotteryController.updateBatch);
router.delete(
  '/batches/:id',
  authorize('ADMIN', 'MANAGER'),
  lotteryController.deleteBatch
);

/**
 * TRANSACTION ROUTES
 */
router.get('/transactions', lotteryController.getTransactions);
router.get('/transactions/:id', lotteryController.getTransactionById);
router.post('/transactions', lotteryController.upsertTransaction);
router.post(
  '/transactions/:id/close',
  authorize('ADMIN', 'MANAGER'),
  lotteryController.closeTransaction
);

/**
 * SCAN ROUTES
 */
router.post('/scan', lotteryController.scanTicket);
router.get('/scans', lotteryController.getScans);

/**
 * REPORTS ROUTES
 */
router.get('/reports/daily-summary', lotteryController.getDailySummary);

/**
 * TICKET TYPE ROUTES
 */
router.get('/ticket-types', lotteryDailyController.getTicketTypes);
router.get('/ticket-types/:id', lotteryDailyController.getTicketTypeById);
router.post('/ticket-types', lotteryDailyController.createTicketType);
router.put('/ticket-types/:id', lotteryDailyController.updateTicketType);
router.delete(
  '/ticket-types/:id',
  authorize('ADMIN', 'MANAGER'),
  lotteryDailyController.deleteTicketType
);

/**
 * DAILY ENTRY ROUTES
 */
router.get('/daily-entries', lotteryDailyController.getDailyEntries);
router.post('/daily-entries', lotteryDailyController.createDailyEntry);
router.put('/daily-entries/:id', lotteryDailyController.updateDailyEntry);
router.delete(
  '/daily-entries/:id',
  authorize('ADMIN', 'MANAGER'),
  lotteryDailyController.deleteDailyEntry
);
router.get('/daily-entries/carry-forward', lotteryDailyController.getCarryForwardInfo);

/**
 * DAY STATUS ROUTES
 */
router.get('/day-status', lotteryDailyController.getDayStatus);
router.put('/day-status/:id', lotteryDailyController.updateDayStatusCashout);
router.post(
  '/day-status/close',
  authorize('ADMIN', 'MANAGER'),
  lotteryDailyController.closeDay
);
router.post(
  '/day-status/:id/reopen',
  authorize('ADMIN', 'SUPER_ADMIN'),
  lotteryDailyController.reopenDay
);

export default router;
