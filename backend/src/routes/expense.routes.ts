import { Router } from 'express';
import * as expenseController from '../controllers/expense.controller';
import { authenticate, authorize } from '../middleware/auth';
import { uploadReceipt } from '../middleware/upload';

const router = Router();

/**
 * All routes require authentication
 */
router.use(authenticate);

/**
 * Export routes - must be before :id routes
 */
router.get('/export/csv', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), expenseController.exportExpensesCSV);
router.get('/export/pdf', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), expenseController.exportExpensesPDF);

/**
 * File upload route
 */
router.post('/upload-receipt', authorize('ADMIN', 'MANAGER'), uploadReceipt, expenseController.uploadReceipt);
router.get('/receipts/:filename', authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), expenseController.downloadReceipt);

/**
 * Bulk action routes
 */
router.post('/bulk-approve', authorize('ADMIN', 'MANAGER'), expenseController.bulkApproveExpenses);
router.post('/bulk-reject', authorize('ADMIN', 'MANAGER'), expenseController.bulkRejectExpenses);

/**
 * Expense routes - ADMIN and MANAGER only
 */
router.get('/', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), expenseController.getAllExpenses);
router.post('/', authorize('ADMIN', 'MANAGER'), expenseController.createExpense);
router.get('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), expenseController.getExpenseById);
router.put('/:id', authorize('ADMIN', 'MANAGER'), expenseController.updateExpense);
router.delete('/:id', authorize('ADMIN'), expenseController.deleteExpense);

/**
 * Expense approval routes
 */
router.post('/:id/approve', authorize('ADMIN', 'MANAGER'), expenseController.approveExpense);
router.post('/:id/reject', authorize('ADMIN', 'MANAGER'), expenseController.rejectExpense);

export default router;
