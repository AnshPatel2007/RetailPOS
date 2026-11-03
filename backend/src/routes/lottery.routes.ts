import { Router, Response, NextFunction } from 'express';
import * as lotteryController from '../controllers/lottery.controller';
import * as lotteryDailyController from '../controllers/lotteryDaily.controller';
import { authenticate, authorize } from '../middleware/auth';
import v2Router from './lotteryV2.routes';
import prisma from '../config/database';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import { reportCalendar } from '../services/reportDates.service';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use('/v2', v2Router);
// Preserve old records, but stop legacy writes once the reviewed cutover starts.
router.use(asyncHandler(async (req: AuthRequest, _res: Response, next: NextFunction) => {
  if (req.method === 'GET') return next();
  if (req.user!.role === 'SUPER_ADMIN') throw new AppError('Business records are read-only in platform inspection', 403);
  if (req.path === '/scan') throw new AppError('Use lottery book checkpoints. Inventory scans do not record individual sales.', 410);
  if (req.user!.locationId) {
    const store = await prisma.location.findUnique({ where: { id: req.user!.locationId }, select: { timezone: true } });
    const calendar = reportCalendar(store?.timezone || 'America/Chicago');
    const today = `${calendar.year}-${String(calendar.month).padStart(2, '0')}-${String(calendar.dayOfMonth).padStart(2, '0')}`;
    if (await prisma.lotteryConfiguration.count({ where: { locationId: req.user!.locationId, effectiveDate: { lte: today } } })) throw new AppError('Legacy lottery history is read-only after cutover. Use the current daily workflow.', 409);
  }
  next();
}));

/**
 * BATCH ROUTES
 */
router.get('/batches', lotteryController.getBatches);
router.get('/batches/:id', lotteryController.getBatchById);
router.post('/batches', authorize('ADMIN', 'MANAGER'), lotteryController.createBatch);
router.put(
  '/batches/:id',
  authorize('ADMIN', 'MANAGER'),
  lotteryController.updateBatch
);
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
router.post('/ticket-types', authorize('ADMIN', 'MANAGER'), lotteryDailyController.createTicketType);
router.put('/ticket-types/:id', authorize('ADMIN', 'MANAGER'), lotteryDailyController.updateTicketType);
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
  authorize('ADMIN'),
  lotteryDailyController.reopenDay
);

export default router;
