import payrollRoutes from './payroll.routes';
import offlineRoutes from './offline.routes';
import jobsRoutes from './jobs.routes';
import approvalRoutes from './approval.routes';
import assistantRoutes from './assistant.routes';
import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './product.routes';
import categoryRoutes from './category.routes';
import saleRoutes from './sale.routes';
import customerRoutes from './customer.routes';
import shiftRoutes from './shift.routes';
import reportRoutes from './report.routes';
import expenseRoutes from './expense.routes';
import supplierRoutes from './supplier.routes';
import purchaseOrderRoutes from './purchaseOrder.routes';
import analyticsRoutes from './analytics.routes';
import financialRoutes from './financial.routes';
import locationRoutes from './location.routes';
import userRoutes from './user.routes';
import giftCardRoutes from './giftCard.routes';
import storeCreditRoutes from './storeCredit.routes';
import exchangeRoutes from './exchange.routes';
import inventoryTransferRoutes from './inventoryTransfer.routes';
import cycleCountRoutes from './cycleCount.routes';
import inventoryExceptionRoutes from './inventoryException.routes';
import pricingRoutes from './pricing.routes';
import lotteryRoutes from './lottery.routes';
import auditLogRoutes from './auditLog.routes';
import promotionRoutes from './promotion.routes';
import houseAccountRoutes from './houseAccount.routes';
import developerRoutes from './developer.routes';

const router = Router();

/**
 * Health check endpoint
 */
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    message: 'POS API is running',
    timestamp: new Date().toISOString(),
  });
});

/**
 * API routes
 */
router.use('/auth', authRoutes);
router.use('/assistant', assistantRoutes);
router.use('/approvals', approvalRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/sales', saleRoutes);
router.use('/customers', customerRoutes);
router.use('/shifts', shiftRoutes);
router.use('/payroll', payrollRoutes);
router.use('/offline', offlineRoutes);
router.use('/jobs', jobsRoutes);
router.use('/reports', reportRoutes);
router.use('/expenses', expenseRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/purchase-orders', purchaseOrderRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/financial', financialRoutes);
router.use('/locations', locationRoutes);
router.use('/users', userRoutes);
router.use('/gift-cards', giftCardRoutes);
router.use('/store-credit', storeCreditRoutes);
router.use('/exchanges', exchangeRoutes);
router.use('/inventory-transfers', inventoryTransferRoutes);
router.use('/cycle-counts', cycleCountRoutes);
router.use('/inventory-exceptions', inventoryExceptionRoutes);
router.use('/pricing', pricingRoutes);
router.use('/lottery', lotteryRoutes);
router.use('/audit-logs', auditLogRoutes);
router.use('/promotions', promotionRoutes);
router.use('/house-accounts', houseAccountRoutes);
router.use('/developer', developerRoutes);

export default router;
