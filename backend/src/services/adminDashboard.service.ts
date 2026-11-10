import { Prisma } from '@prisma/client';
import { getFinancialMetrics } from './financialMetrics.service';
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// This overview belongs only to the super-admin dashboard. Store reports keep their own API.
export async function getAdminDashboard(period: unknown = '30', now = new Date()) {
  if (typeof period !== 'string' || !['1', '7', '30', '90', '365', 'max'].includes(period)) {
    throw new AppError('Choose a supported dashboard period', 400);
  }
  const start = period === 'max' ? null : new Date(now.getTime() - Number(period) * 86400000);
  const dateRange = { ...(start ? { gte: start } : {}), lte: now };

  return prisma.$transaction(async tx => {
    const stores = await tx.location.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isActive: true, city: true, state: true, email: true },
    });
    const storeIds = stores.map(store => store.id);
    const scope = { locationId: { in: storeIds } };
    // Sales, refunds, voids and expenses come from the shared metrics (aggregated in
    // SQL), so these figures match each store's own dashboard and P&L.
    const [users, shifts, pending, products, totalCustomers, newCustomers] = await Promise.all([
      tx.user.groupBy({ by: ['locationId'], where: { ...scope, isActive: true }, _count: true }),
      tx.shift.groupBy({ by: ['locationId'], where: { ...scope, clockOutAt: null, isClosed: false }, _count: true }),
      tx.sale.groupBy({ by: ['locationId'], where: { ...scope, status: { in: ['PENDING', 'HOLD'] } }, _count: true }),
      tx.product.findMany({ where: { ...scope, isActive: true, sku: { not: 'MISC-001' } }, select: { id: true, locationId: true, trackInventory: true, stockQuantity: true, lowStockAlert: true, cost: true } }),
      tx.customer.count({ where: { isActive: true, OR: [scope, { locationId: null }] } }),
      tx.customer.count({ where: { isActive: true, createdAt: dateRange, OR: [scope, { locationId: null }] } }),
    ]);
    const financial = new Map(await Promise.all(stores.map(async store => [store.id, await getFinancialMetrics({ locationId: store.id }, dateRange, tx)] as const)));
    const valuation = await tx.inventoryValuation.findMany({ where: scope });
    const locations = stores.map(store => {
      const storeProducts = products.filter(product => product.locationId === store.id);
      const metrics = financial.get(store.id)!;
      const inventoryMissing = storeProducts.some(p => p.trackInventory && p.stockQuantity > 0 && valuation.find(v => v.productId === p.id)?.value == null);
      const profit = metrics.netProfit;
      const margin = profit === null || !metrics.netSales ? null : money(profit / metrics.netSales * 100);
      return {
        locationId: store.id, locationName: store.name, isActive: store.isActive, city: store.city, state: store.state, email: store.email,
        grossCollected: metrics.grossCollected, revenue: metrics.netCollected, transactions: metrics.transactions,
        voidAmount: metrics.voids, voidCount: metrics.voidCount, historyWarning: metrics.historyWarning,
        expenses: metrics.recordedExpenses, operatingExpenses: metrics.operatingExpenses, inventoryPurchases: metrics.inventoryPurchases,
        profit, margin, costOfGoodsSold: metrics.costOfGoodsSold, costBasis: metrics.costBasis, unavailableReason: metrics.unavailableReason,
        netSalesBeforeTax: metrics.netSales, refundTax: metrics.refundTax,
        activeUsers: users.find(row => row.locationId === store.id)?._count || 0,
        activeShifts: shifts.find(row => row.locationId === store.id)?._count || 0,
        pendingSales: pending.find(row => row.locationId === store.id)?._count || 0,
        lowStockCount: storeProducts.filter(p => p.trackInventory && p.stockQuantity > 0 && p.stockQuantity <= p.lowStockAlert).length,
        outOfStockCount: storeProducts.filter(p => p.trackInventory && p.stockQuantity <= 0).length,
        productCount: storeProducts.length,
        inventoryValue: inventoryMissing ? null : money(valuation.filter(v => v.locationId === store.id).reduce((n, v) => n + Number(v.value || 0), 0)),
        refundCount: metrics.refundCount, refundAmount: metrics.refunds, taxCharged: metrics.taxCharged,
      };
    });
    const sum = (key: 'revenue' | 'grossCollected' | 'transactions' | 'expenses' | 'operatingExpenses' | 'inventoryPurchases' | 'activeUsers' | 'activeShifts' | 'pendingSales' | 'lowStockCount' | 'outOfStockCount' | 'productCount' | 'inventoryValue' | 'refundCount' | 'refundAmount' | 'taxCharged' | 'refundTax' | 'voidAmount' | 'voidCount') => money(locations.reduce((total, location) => total + Number(location[key] || 0), 0));
    const totalProfit = locations.some(location => location.profit === null) ? null : money(locations.reduce((total, location) => total + (location.profit || 0), 0));
    const preTaxSales = locations.some(location => location.netSalesBeforeTax === null) ? null : money(locations.reduce((n, location) => n + (location.netSalesBeforeTax || 0), 0));
    return {
      locations, period, rangeStart: start?.toISOString() || null, rangeEnd: now.toISOString(), updatedAt: now.toISOString(),
      totals: {
        totalStores: locations.length, activeStores: locations.filter(store => store.isActive).length,
        totalRevenue: sum('revenue'), totalGrossCollected: sum('grossCollected'), totalTransactions: sum('transactions'),
        totalVoids: sum('voidCount'), totalVoidAmount: sum('voidAmount'),
        totalExpenses: sum('expenses'), totalOperatingExpenses: sum('operatingExpenses'), totalInventoryPurchases: sum('inventoryPurchases'), totalProfit, margin: totalProfit !== null && preTaxSales !== null && preTaxSales > 0 ? money(totalProfit / preTaxSales * 100) : null,
        totalUsers: sum('activeUsers'), totalActiveShifts: sum('activeShifts'), totalPendingSales: sum('pendingSales'),
        totalLowStock: sum('lowStockCount'), totalOutOfStock: sum('outOfStockCount'), totalProducts: sum('productCount'),
        totalInventoryValue: locations.some(row => row.inventoryValue === null) ? null : sum('inventoryValue'), totalRefunds: sum('refundCount'), totalRefundAmount: sum('refundAmount'), totalTaxCharged: sum('taxCharged'),
      },
      globalMetrics: { totalCustomers, newCustomers },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}
