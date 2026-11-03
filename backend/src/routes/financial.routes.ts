import { Router } from 'express';
import * as financialController from '../controllers/financial.controller';
import { authenticate, authorize } from '../middleware/auth';
import reconciliationRoutes from './reconciliation.routes';
import inventoryCostRoutes from './inventoryCost.routes';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use('/reconciliation', reconciliationRoutes);
router.use('/inventory-costs', inventoryCostRoutes);

// ==================== BUDGETS ====================

/**
 * Get budget summary
 */
router.get(
  '/budgets/summary',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  financialController.getBudgetSummary
);

/**
 * Get all budgets
 */
router.get(
  '/budgets',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  financialController.getBudgets
);

/**
 * Create a budget
 */
router.post(
  '/budgets',
  authorize('ADMIN', 'MANAGER'),
  financialController.createBudget
);

/**
 * Update a budget
 */
router.put(
  '/budgets/:id',
  authorize('ADMIN', 'MANAGER'),
  financialController.updateBudget
);

/**
 * Delete a budget
 */
router.delete(
  '/budgets/:id',
  authorize('ADMIN'),
  financialController.deleteBudget
);

// ==================== RECURRING EXPENSES ====================

/**
 * Generate due recurring expenses
 */
router.post(
  '/recurring-expenses/generate',
  authorize('ADMIN', 'MANAGER'),
  financialController.generateRecurringExpenses
);

/**
 * Get all recurring expenses
 */
router.get(
  '/recurring-expenses',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  financialController.getRecurringExpenses
);

/**
 * Create a recurring expense
 */
router.post(
  '/recurring-expenses',
  authorize('ADMIN', 'MANAGER'),
  financialController.createRecurringExpense
);

/**
 * Update a recurring expense
 */
router.put(
  '/recurring-expenses/:id',
  authorize('ADMIN', 'MANAGER'),
  financialController.updateRecurringExpense
);

/**
 * Delete a recurring expense
 */
router.delete(
  '/recurring-expenses/:id',
  authorize('ADMIN'),
  financialController.deleteRecurringExpense
);

// ==================== ACCOUNTING EXPORTS ====================

/**
 * Get export history
 */
router.get(
  '/exports',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  financialController.getExportHistory
);

/**
 * Export sales for accounting
 */
router.get(
  '/export/sales',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  financialController.exportSales
);

/**
 * Export expenses for accounting
 */
router.get(
  '/export/expenses',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  financialController.exportExpenses
);

/**
 * Get P&L report
 */
router.get(
  '/reports/pnl',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  financialController.getProfitAndLoss
);

export default router;
