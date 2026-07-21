import { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import prisma from '../config/database';
import { SaleStatus, ExpenseStatus } from '@prisma/client';
import { AuthRequest } from '../types';
import { createDateFilter } from '../utils/dateFilter.util';
import { parseListFilter } from '../utils/queryFilter.util';
import { getLocationFilter } from '../utils/locationFilter.util';

/** Round a number to 2 decimal places (currency precision) */
const rc = (n: number) => Math.round(n * 100) / 100;

/**
 * Refunded totals from the Refund table (includes partial refunds) for a
 * createdAt date range. Sales keep status COMPLETED after a partial refund,
 * so report revenue must subtract these amounts explicitly.
 */
const getRefundTotals = async (
  dateFilter?: { gte?: Date; lt?: Date; lte?: Date },
  locationId?: string
): Promise<{ amount: number; count: number }> => {
  const result = await prisma.refund.aggregate({
    where: {
      ...(dateFilter ? { createdAt: dateFilter } : {}),
      ...(locationId ? { sale: { locationId } } : {}),
    },
    _sum: { amount: true },
    _count: true,
  });
  return { amount: result._sum.amount || 0, count: result._count };
};

/**
 * Get overall business report - comprehensive metrics for small-mid size businesses
 * GET /api/reports/overall
 */
export const getOverallReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationFilter = getLocationFilter(req, req.query.locationId as string);
  // Date boundaries
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const yearAgo = new Date(today);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const previousWeek = new Date(weekAgo);
  previousWeek.setDate(previousWeek.getDate() - 7);

  const previousMonth = new Date(monthAgo);
  previousMonth.setMonth(previousMonth.getMonth() - 1);

  // ==================== REVENUE METRICS ====================

  // Revenue counts sales when they happened (COMPLETED + later fully
  // REFUNDED); refunds are subtracted in the period they were issued via the
  // Refund table, which also covers partial refunds on COMPLETED sales.
  const revenueStatuses = { in: [SaleStatus.COMPLETED, SaleStatus.REFUNDED] };

  // Today's sales
  const todaySales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: today, lte: endOfToday },
      status: revenueStatuses,
      ...locationFilter,
    },
    _sum: { total: true, tax: true, discount: true, subtotal: true },
    _count: true,
  });

  // This week's sales
  const weekSales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: weekAgo },
      status: revenueStatuses,
      ...locationFilter,
    },
    _sum: { total: true, tax: true, discount: true },
    _count: true,
  });

  // Previous week's sales (for comparison)
  const prevWeekSales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: previousWeek, lt: weekAgo },
      status: revenueStatuses,
      ...locationFilter,
    },
    _sum: { total: true },
    _count: true,
  });

  // This month's sales
  const monthSales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: monthAgo },
      status: revenueStatuses,
      ...locationFilter,
    },
    _sum: { total: true, tax: true, discount: true },
    _count: true,
  });

  // Previous month's sales (for comparison)
  const prevMonthSales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: previousMonth, lt: monthAgo },
      status: revenueStatuses,
      ...locationFilter,
    },
    _sum: { total: true },
    _count: true,
  });

  // This year's sales
  const yearSales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: yearAgo },
      status: revenueStatuses,
      ...locationFilter,
    },
    _sum: { total: true, tax: true, discount: true },
    _count: true,
  });

  // Refunds issued per period (partial + full)
  const [todayRefunds, weekRefunds, prevWeekRefunds, monthRefunds, prevMonthRefunds, yearRefunds] =
    await Promise.all([
      getRefundTotals({ gte: today, lte: endOfToday }, locationFilter.locationId),
      getRefundTotals({ gte: weekAgo }, locationFilter.locationId),
      getRefundTotals({ gte: previousWeek, lt: weekAgo }, locationFilter.locationId),
      getRefundTotals({ gte: monthAgo }, locationFilter.locationId),
      getRefundTotals({ gte: previousMonth, lt: monthAgo }, locationFilter.locationId),
      getRefundTotals({ gte: yearAgo }, locationFilter.locationId),
    ]);

  const todayNet = rc((todaySales._sum.total || 0) - todayRefunds.amount);
  const weekNet = rc((weekSales._sum.total || 0) - weekRefunds.amount);
  const prevWeekNet = rc((prevWeekSales._sum.total || 0) - prevWeekRefunds.amount);
  const monthNet = rc((monthSales._sum.total || 0) - monthRefunds.amount);
  const prevMonthNet = rc((prevMonthSales._sum.total || 0) - prevMonthRefunds.amount);
  const yearNet = rc((yearSales._sum.total || 0) - yearRefunds.amount);

  // Calculate growth percentages (on refund-adjusted revenue)
  const weeklyGrowth = prevWeekNet
    ? ((weekNet - prevWeekNet) / prevWeekNet) * 100
    : 0;

  const monthlyGrowth = prevMonthNet
    ? ((monthNet - prevMonthNet) / prevMonthNet) * 100
    : 0;

  // ==================== PROFIT & COST ANALYSIS ====================

  // Get all completed sales with items for profit calculation
  const salesWithItems = await prisma.sale.findMany({
    where: {
      createdAt: { gte: monthAgo },
      status: SaleStatus.COMPLETED,
      ...locationFilter,
    },
    select: {
      total: true,
      items: {
        select: {
          quantity: true,
          price: true,
          product: {
            select: {
              cost: true,
            },
          },
        },
      },
    },
  });

  // Calculate cost of goods sold and gross profit
  let totalCOGS = 0;
  salesWithItems.forEach((sale) => {
    sale.items.forEach((item) => {
      totalCOGS += rc((item.product?.cost || 0) * item.quantity);
    });
  });
  totalCOGS = rc(totalCOGS);

  const grossProfit = rc(monthNet - totalCOGS);
  const grossMargin = monthNet ? rc((grossProfit / monthNet) * 100) : 0;

  // Get expenses for net profit (include all statuses except REJECTED)
  const monthExpenses = await prisma.expense.aggregate({
    where: {
      expenseDate: { gte: monthAgo },
      status: { notIn: [ExpenseStatus.REJECTED] },
      ...locationFilter,
    },
    _sum: { amount: true },
    _count: true,
  });

  const netProfit = rc(grossProfit - (monthExpenses._sum.amount || 0));
  const netMargin = monthNet ? rc((netProfit / monthNet) * 100) : 0;

  // ==================== CUSTOMER INSIGHTS ====================

  // Total customers
  const totalCustomers = await prisma.customer.count({
    where: { isActive: true, ...locationFilter },
  });

  // New customers this month
  const newCustomers = await prisma.customer.count({
    where: {
      createdAt: { gte: monthAgo },
      isActive: true,
      ...locationFilter,
    },
  });

  // Returning customers (with more than one visit)
  const returningCustomers = await prisma.customer.count({
    where: {
      visitCount: { gt: 1 },
      isActive: true,
      ...locationFilter,
    },
  });

  // Top customers by spend
  const topCustomers = await prisma.customer.findMany({
    where: { isActive: true, ...locationFilter },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      totalSpent: true,
      visitCount: true,
      lastVisitAt: true,
    },
    orderBy: { totalSpent: 'desc' },
    take: 10,
  });

  // Average customer lifetime value
  const avgCustomerValue = await prisma.customer.aggregate({
    where: {
      isActive: true,
      totalSpent: { gt: 0 },
      ...locationFilter,
    },
    _avg: { totalSpent: true },
  });

  // ==================== INVENTORY HEALTH ====================

  // All products summary
  const allProducts = await prisma.product.findMany({
    where: { isActive: true, ...locationFilter },
    select: {
      id: true,
      name: true,
      sku: true,
      cost: true,
      price: true,
      stockQuantity: true,
      lowStockAlert: true,
      trackInventory: true,
    },
  });

  const totalProducts = allProducts.length;
  const totalInventoryValue = rc(allProducts.reduce((sum, p) => sum + rc(p.cost * p.stockQuantity), 0));
  const totalRetailValue = rc(allProducts.reduce((sum, p) => sum + rc(p.price * p.stockQuantity), 0));

  // Low stock items
  const lowStockItems = allProducts.filter(
    (p) => p.trackInventory && p.stockQuantity > 0 && p.stockQuantity <= p.lowStockAlert
  );

  // Out of stock items
  const outOfStockItems = allProducts.filter(
    (p) => p.trackInventory && p.stockQuantity === 0
  );

  // Stock turnover (items sold vs avg inventory)
  const itemsSold = await prisma.saleItem.aggregate({
    where: {
      sale: {
        createdAt: { gte: monthAgo },
        status: SaleStatus.COMPLETED,
        ...locationFilter,
      },
    },
    _sum: { quantity: true },
  });

  const avgInventory = totalProducts > 0
    ? allProducts.reduce((sum, p) => sum + p.stockQuantity, 0) / totalProducts
    : 0;
  const stockTurnover = avgInventory > 0
    ? (itemsSold._sum.quantity || 0) / avgInventory
    : 0;

  // ==================== TOP SELLING PRODUCTS ====================

  const topProducts = await prisma.saleItem.groupBy({
    by: ['productId', 'productName'],
    where: {
      sale: {
        createdAt: { gte: monthAgo },
        status: SaleStatus.COMPLETED,
        ...locationFilter,
      },
    },
    _sum: {
      quantity: true,
      total: true,
    },
    orderBy: {
      _sum: {
        total: 'desc',
      },
    },
    take: 10,
  });

  // ==================== SALES BY CATEGORY ====================

  const salesByCategory = await prisma.saleItem.findMany({
    where: {
      sale: {
        createdAt: { gte: monthAgo },
        status: SaleStatus.COMPLETED,
        ...locationFilter,
      },
    },
    select: {
      total: true,
      quantity: true,
      product: {
        select: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const categoryBreakdown = salesByCategory.reduce((acc: any, item) => {
    const catName = item.product?.category?.name || 'Uncategorized';
    if (!acc[catName]) {
      acc[catName] = { name: catName, revenue: 0, quantity: 0 };
    }
    acc[catName].revenue = rc(acc[catName].revenue + item.total);
    acc[catName].quantity += item.quantity;
    return acc;
  }, {});

  const categoryData = Object.values(categoryBreakdown)
    .sort((a: any, b: any) => b.revenue - a.revenue);

  // ==================== PAYMENT METHOD BREAKDOWN ====================

  const paymentMethodStats = await prisma.sale.groupBy({
    by: ['paymentMethod'],
    where: {
      createdAt: { gte: monthAgo },
      status: SaleStatus.COMPLETED,
      ...locationFilter,
    },
    _sum: { total: true },
    _count: true,
  });

  const paymentBreakdown = paymentMethodStats.map((pm) => ({
    method: pm.paymentMethod,
    total: pm._sum.total || 0,
    count: pm._count,
    percentage: monthSales._sum.total
      ? rc(((pm._sum.total || 0) / (monthSales._sum.total || 1)) * 100)
      : 0,
  }));

  // ==================== EMPLOYEE PERFORMANCE ====================

  const employeeStats = await prisma.sale.groupBy({
    by: ['userId'],
    where: {
      createdAt: { gte: monthAgo },
      status: SaleStatus.COMPLETED,
      ...locationFilter,
    },
    _sum: { total: true },
    _count: true,
  });

  const employeeIds = employeeStats.map((e) => e.userId);
  const employees = await prisma.user.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true, firstName: true, lastName: true },
  });

  const employeePerformance = employeeStats.map((stat) => {
    const employee = employees.find((e) => e.id === stat.userId);
    return {
      id: stat.userId,
      name: employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown',
      totalSales: stat._sum.total || 0,
      transactions: stat._count,
      avgOrderValue: stat._count > 0 ? rc((stat._sum.total || 0) / stat._count) : 0,
    };
  }).sort((a, b) => b.totalSales - a.totalSales);

  // ==================== EXPENSE BREAKDOWN ====================

  const expensesByCategory = await prisma.expense.groupBy({
    by: ['category'],
    where: {
      expenseDate: { gte: monthAgo },
      status: { notIn: [ExpenseStatus.REJECTED] },
      ...locationFilter,
    },
    _sum: { amount: true },
    _count: true,
  });

  const expenseBreakdown = expensesByCategory.map((exp) => ({
    category: exp.category,
    total: exp._sum.amount || 0,
    count: exp._count,
    percentage: monthExpenses._sum.amount
      ? rc(((exp._sum.amount || 0) / (monthExpenses._sum.amount || 1)) * 100)
      : 0,
  })).sort((a, b) => b.total - a.total);

  // ==================== DAILY SALES TREND (last 30 days) ====================

  const dailySales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: monthAgo },
      status: SaleStatus.COMPLETED,
      ...locationFilter,
    },
    select: {
      total: true,
      createdAt: true,
    },
  });

  const salesByDay: any = {};
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    salesByDay[dateKey] = { date: dateKey, sales: 0, transactions: 0 };
  }

  dailySales.forEach((sale) => {
    const dateKey = sale.createdAt.toISOString().split('T')[0];
    if (salesByDay[dateKey]) {
      salesByDay[dateKey].sales = rc(salesByDay[dateKey].sales + sale.total);
      salesByDay[dateKey].transactions += 1;
    }
  });

  const dailySalesTrend = Object.values(salesByDay);

  // ==================== HOURLY SALES PATTERN (today) ====================

  const todaySalesDetail = await prisma.sale.findMany({
    where: {
      createdAt: { gte: today, lte: endOfToday },
      status: SaleStatus.COMPLETED,
      ...locationFilter,
    },
    select: {
      total: true,
      createdAt: true,
    },
  });

  const hourlyPattern: any = {};
  for (let i = 0; i < 24; i++) {
    hourlyPattern[i] = { hour: i, sales: 0, transactions: 0 };
  }

  todaySalesDetail.forEach((sale) => {
    const hour = sale.createdAt.getHours();
    hourlyPattern[hour].sales = rc(hourlyPattern[hour].sales + sale.total);
    hourlyPattern[hour].transactions += 1;
  });

  const hourlySalesPattern = Object.values(hourlyPattern);

  // ==================== AVERAGE ORDER VALUE TRENDS ====================

  const avgOrderToday = todaySales._count > 0
    ? (todaySales._sum.total || 0) / todaySales._count
    : 0;
  const avgOrderWeek = weekSales._count > 0
    ? (weekSales._sum.total || 0) / weekSales._count
    : 0;
  const avgOrderMonth = monthSales._count > 0
    ? (monthSales._sum.total || 0) / monthSales._count
    : 0;

  // ==================== REFUNDS & VOIDS ====================

  const voidsThisMonth = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: monthAgo },
      status: SaleStatus.VOIDED,
      ...locationFilter,
    },
    _sum: { total: true },
    _count: true,
  });

  // ==================== COMPILE RESPONSE ====================

  res.json({
    success: true,
    data: {
      // Revenue Overview (net of refunds issued in each period)
      revenue: {
        today: {
          total: todayNet,
          transactions: todaySales._count,
          tax: todaySales._sum.tax || 0,
          discount: todaySales._sum.discount || 0,
        },
        week: {
          total: weekNet,
          transactions: weekSales._count,
          growth: Math.round(weeklyGrowth * 100) / 100,
        },
        month: {
          total: monthNet,
          transactions: monthSales._count,
          growth: Math.round(monthlyGrowth * 100) / 100,
        },
        year: {
          total: yearNet,
          transactions: yearSales._count,
        },
      },

      // Profitability
      profitability: {
        grossProfit: Math.round(grossProfit * 100) / 100,
        grossMargin: Math.round(grossMargin * 100) / 100,
        netProfit: Math.round(netProfit * 100) / 100,
        netMargin: Math.round(netMargin * 100) / 100,
        costOfGoodsSold: Math.round(totalCOGS * 100) / 100,
        totalExpenses: monthExpenses._sum.amount || 0,
      },

      // Average Order Values
      averageOrderValue: {
        today: Math.round(avgOrderToday * 100) / 100,
        week: Math.round(avgOrderWeek * 100) / 100,
        month: Math.round(avgOrderMonth * 100) / 100,
      },

      // Customer Insights
      customers: {
        total: totalCustomers,
        new: newCustomers,
        returning: returningCustomers,
        retentionRate: totalCustomers > 0
          ? Math.round((returningCustomers / totalCustomers) * 100 * 100) / 100
          : 0,
        avgLifetimeValue: Math.round((avgCustomerValue._avg.totalSpent || 0) * 100) / 100,
        topCustomers,
      },

      // Inventory Health
      inventory: {
        totalProducts,
        inventoryValue: Math.round(totalInventoryValue * 100) / 100,
        retailValue: Math.round(totalRetailValue * 100) / 100,
        potentialProfit: Math.round((totalRetailValue - totalInventoryValue) * 100) / 100,
        lowStockCount: lowStockItems.length,
        outOfStockCount: outOfStockItems.length,
        stockTurnover: Math.round(stockTurnover * 100) / 100,
        lowStockItems: lowStockItems.slice(0, 10).map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          stock: p.stockQuantity,
          alert: p.lowStockAlert,
        })),
        outOfStockItems: outOfStockItems.slice(0, 10).map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
        })),
      },

      // Top Products
      topProducts: topProducts.map((p) => ({
        productId: p.productId,
        name: p.productName,
        quantitySold: p._sum.quantity || 0,
        revenue: p._sum.total || 0,
      })),

      // Sales by Category
      salesByCategory: categoryData,

      // Payment Methods
      paymentMethods: paymentBreakdown,

      // Employee Performance
      employeePerformance,

      // Expense Summary
      expenses: {
        total: monthExpenses._sum.amount || 0,
        count: monthExpenses._count,
        breakdown: expenseBreakdown,
      },

      // Trends
      trends: {
        dailySales: dailySalesTrend,
        hourlySales: hourlySalesPattern,
      },

      // Refunds & Voids (refunds from the Refund table, includes partials)
      refundsAndVoids: {
        refunds: {
          total: rc(monthRefunds.amount),
          count: monthRefunds.count,
        },
        voids: {
          total: voidsThisMonth._sum.total || 0,
          count: voidsThisMonth._count,
        },
      },
    },
  });
});

/**
 * Get dashboard metrics
 * GET /api/reports/dashboard
 */
export const getDashboardMetrics = asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;

  // Build base filter for role-based sales visibility. SUPER_ADMIN may pass
  // ?locationId= to drill into one store; everyone else is forced to their own.
  const locationFilter = getLocationFilter(authReq, authReq.query.locationId as string);
  const baseWhere: any = { status: SaleStatus.COMPLETED, ...locationFilter };
  // Cashiers only see their own sales
  if (authReq.user?.role === 'CASHIER') {
    baseWhere.userId = authReq.user.id;
  }

  // Use UTC boundaries to avoid server-timezone drift
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, now.getUTCDate()));
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, now.getUTCDate()));

  // Run all queries concurrently
  const [
    todaySales,
    yesterdaySales,
    weekSales,
    prevWeekSales,
    monthSales,
    prevMonthSales,
    todayRefunds,
    lowStockProducts,
    totalProducts,
    totalCustomers,
    activeEmployees,
    recentSales,
    todayPaymentBreakdown,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { ...baseWhere, createdAt: { gte: today } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { ...baseWhere, createdAt: { gte: yesterday, lt: today } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { ...baseWhere, createdAt: { gte: weekAgo } },
      _sum: { total: true },
    }),
    prisma.sale.aggregate({
      where: { ...baseWhere, createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
      _sum: { total: true },
    }),
    prisma.sale.aggregate({
      where: { ...baseWhere, createdAt: { gte: monthAgo } },
      _sum: { total: true },
    }),
    prisma.sale.aggregate({
      where: { ...baseWhere, createdAt: { gte: prevMonthStart, lt: monthAgo } },
      _sum: { total: true },
    }),
    // Today's refunds (from Refund table, includes partial refunds)
    prisma.refund.aggregate({
      where: {
        createdAt: { gte: today },
        sale: {
          ...(locationFilter.locationId ? { locationId: locationFilter.locationId } : {}),
          ...(authReq.user?.role === 'CASHIER' ? { userId: authReq.user.id } : {}),
        },
      },
      _sum: { amount: true },
      _count: true,
    }),
    // Low stock products (with names)
    prisma.product.findMany({
      where: { trackInventory: true, isActive: true, ...locationFilter },
      select: { id: true, name: true, sku: true, stockQuantity: true, lowStockAlert: true },
    }),
    prisma.product.count({ where: { isActive: true, ...locationFilter } }),
    prisma.customer.count({ where: { isActive: true, ...locationFilter } }),
    prisma.shift.count({ where: { isClosed: false, ...locationFilter } }),
    // Recent 5 sales
    prisma.sale.findMany({
      where: baseWhere,
      select: {
        id: true, saleNumber: true, total: true, paymentMethod: true, createdAt: true,
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    // Today's payment method breakdown
    prisma.sale.groupBy({
      by: ['paymentMethod'],
      where: { ...baseWhere, createdAt: { gte: today } },
      _sum: { total: true },
      _count: true,
    }),
  ]);

  const allLowStock = lowStockProducts
    .filter(p => p.stockQuantity <= p.lowStockAlert)
    .sort((a, b) => a.stockQuantity - b.stockQuantity);
  const lowStockItems = allLowStock
    .slice(0, 5)
    .map(p => ({ id: p.id, name: p.name, sku: p.sku, stock: p.stockQuantity, alert: p.lowStockAlert }));

  const todayTotal = todaySales._sum.total || 0;
  const yesterdayTotal = yesterdaySales._sum.total || 0;
  const weekTotal = weekSales._sum.total || 0;
  const prevWeekTotal = prevWeekSales._sum.total || 0;
  const monthTotal = monthSales._sum.total || 0;
  const prevMonthTotal = prevMonthSales._sum.total || 0;

  const avgOrderValue = todaySales._count > 0
    ? (todaySales._sum.total || 0) / todaySales._count
    : null; // null = no sales, frontend shows "N/A"

  const calcTrend = (current: number, previous: number): number | null => {
    if (previous === 0 && current === 0) return null;
    if (previous === 0) return null; // can't compare to zero baseline
    return Math.round(((current - previous) / previous) * 100 * 10) / 10;
  };

  const paymentBreakdown = todayPaymentBreakdown.map(p => ({
    method: p.paymentMethod,
    total: p._sum.total || 0,
    count: p._count,
  }));

  res.json({
    success: true,
    data: {
      todaySales: todayTotal,
      todayTransactions: todaySales._count,
      todayTrend: calcTrend(todayTotal, yesterdayTotal),
      weekSales: weekTotal,
      weekTrend: calcTrend(weekTotal, prevWeekTotal),
      monthSales: monthTotal,
      monthTrend: calcTrend(monthTotal, prevMonthTotal),
      averageOrderValue: avgOrderValue !== null ? Math.round(avgOrderValue * 100) / 100 : null,
      todayRefunds: todayRefunds._sum.amount || 0,
      todayRefundCount: todayRefunds._count,
      lowStockCount: allLowStock.length,
      lowStockItems,
      totalProducts,
      totalCustomers,
      activeEmployees,
      recentSales: recentSales.map(s => ({
        id: s.id,
        saleNumber: s.saleNumber,
        total: s.total,
        paymentMethod: s.paymentMethod,
        createdAt: s.createdAt,
        customerName: s.customer ? `${s.customer.firstName} ${s.customer.lastName}` : null,
      })),
      paymentBreakdown,
    },
  });
});

/**
 * Get hourly sales data + top products + active shifts for dashboard widgets
 * GET /api/reports/dashboard/hourly
 */
export const getDashboardHourly = asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;

  const now = new Date();
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // SUPER_ADMIN may pass ?locationId= to drill into one store
  const locationFilter = getLocationFilter(authReq, authReq.query.locationId as string);
  // Cashiers only see their own sales
  const userFilter = authReq.user?.role === 'CASHIER' ? { userId: authReq.user.id } : {};

  // Hourly sales for the last 12 hours
  const hourlySales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: twelveHoursAgo },
      status: SaleStatus.COMPLETED,
      ...locationFilter,
      ...userFilter,
    },
    select: { createdAt: true, total: true },
  });

  // Bucket into hours with epoch timestamps so the client can sort and format locally
  const buckets: { timestamp: number; total: number }[] = [];
  for (let h = 0; h <= 12; h++) {
    const hourStart = new Date(twelveHoursAgo.getTime() + h * 60 * 60 * 1000);
    // Truncate to the start of that hour
    hourStart.setUTCMinutes(0, 0, 0);
    buckets.push({ timestamp: hourStart.getTime(), total: 0 });
  }
  hourlySales.forEach((sale) => {
    const saleTime = new Date(sale.createdAt).getTime();
    // Find the correct bucket
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (saleTime >= buckets[i].timestamp) {
        buckets[i].total += sale.total || 0;
        break;
      }
    }
  });

  const hourlyData = buckets.map((b) => ({
    timestamp: b.timestamp,
    total: Math.round(b.total * 100) / 100,
  }));

  // Top 5 products today
  const topProducts = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: {
      sale: {
        createdAt: { gte: today },
        status: SaleStatus.COMPLETED,
        ...locationFilter,
        ...userFilter,
      },
    },
    _sum: { quantity: true, total: true },
    _count: { productId: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: 5,
  });

  const productIds = topProducts.map((p) => p.productId);
  const productDetails = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, price: true },
  });

  const topProductsResult = topProducts.map((p) => {
    const detail = productDetails.find((d) => d.id === p.productId);
    return {
      productId: p.productId,
      name: detail?.name || 'Unknown',
      qty: p._sum.quantity || 0,
      revenue: Math.round((p._sum.total || 0) * 100) / 100,
    };
  });

  // Active shifts
  const activeShifts = await prisma.shift.findMany({
    where: { isClosed: false, ...locationFilter },
    select: {
      id: true,
      clockInAt: true,
      totalSales: true,
      totalTransactions: true,
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { clockInAt: 'asc' },
    take: 10,
  });

  res.json({
    success: true,
    data: {
      hourlyData,
      topProducts: topProductsResult,
      activeShifts: activeShifts.map((s) => ({
        id: s.id,
        employeeName: `${s.user.firstName} ${s.user.lastName}`,
        clockInAt: s.clockInAt,
        totalSales: s.totalSales,
        totalTransactions: s.totalTransactions,
      })),
    },
  });
});

/**
 * Get sales report
 * GET /api/reports/sales
 */
export const getSalesReport = asyncHandler(async (_req: Request, res: Response) => {
  const {
    startDate,
    endDate,
    locationId,
    userId,
    paymentMethod,
    customerId,
    status,
    minAmount,
    maxAmount,
  } = _req.query;

  const where: any = {
    status: parseListFilter(status) ?? SaleStatus.COMPLETED,
  };

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) {
    where.createdAt = dateFilter;
  }

  if (locationId) where.locationId = locationId;
  const userFilter = parseListFilter(userId);
  if (userFilter) where.userId = userFilter;
  const paymentMethodFilter = parseListFilter(paymentMethod);
  if (paymentMethodFilter) where.paymentMethod = paymentMethodFilter;
  if (customerId) where.customerId = customerId;

  if (minAmount || maxAmount) {
    where.total = {};
    if (minAmount) where.total.gte = parseFloat(minAmount as string);
    if (maxAmount) where.total.lte = parseFloat(maxAmount as string);
  }

  const sales = await prisma.sale.findMany({
    where,
    select: {
      id: true,
      saleNumber: true,
      customerId: true,
      userId: true,
      total: true,
      subtotal: true,
      tax: true,
      discount: true,
      paymentMethod: true,
      amountPaid: true,
      changeDue: true,
      status: true,
      createdAt: true,
      completedAt: true,
      items: {
        select: {
          id: true,
          productId: true,
          productName: true,
          quantity: true,
          price: true,
          total: true,
          discount: true,
        },
      },
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate summary
  const totalSalesSum = rc(sales.reduce((sum, sale) => sum + sale.total, 0));
  const summary = {
    totalSales: totalSalesSum,
    totalTransactions: sales.length,
    averageOrderValue: sales.length > 0 ? rc(totalSalesSum / sales.length) : 0,
    totalTax: rc(sales.reduce((sum, sale) => sum + sale.tax, 0)),
    totalDiscount: rc(sales.reduce((sum, sale) => sum + sale.discount, 0)),
  };

  // Payment method breakdown
  const paymentBreakdown = sales.reduce((acc: any, sale) => {
    const method = sale.paymentMethod;
    if (!acc[method]) {
      acc[method] = { count: 0, total: 0 };
    }
    acc[method].count++;
    acc[method].total = rc(acc[method].total + sale.total);
    return acc;
  }, {});

  // Employee sales breakdown
  const employeeBreakdown = sales.reduce((acc: any, sale) => {
    if (sale.user) {
      const employeeId = sale.user.id;
      const employeeName = `${sale.user.firstName} ${sale.user.lastName}`;
      if (!acc[employeeId]) {
        acc[employeeId] = { name: employeeName, count: 0, total: 0 };
      }
      acc[employeeId].count++;
      acc[employeeId].total = rc(acc[employeeId].total + sale.total);
    }
    return acc;
  }, {});

  res.json({
    success: true,
    data: {
      sales,
      summary,
      paymentBreakdown,
      employeeBreakdown,
    },
  });
});

/**
 * Get inventory report
 * GET /api/reports/inventory
 */
export const getInventoryReport = asyncHandler(async (req: Request, res: Response) => {
  const { categoryId, lowStock } = req.query;

  const where: any = { isActive: true };

  if (categoryId) where.categoryId = categoryId;

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true,
      sku: true,
      name: true,
      description: true,
      image: true,
      barcode: true,
      cost: true,
      price: true,
      compareAtPrice: true,
      stockQuantity: true,
      lowStockAlert: true,
      categoryId: true,
      isActive: true,
      isTaxable: true,
      trackInventory: true,
      allowBackorder: true,
      createdAt: true,
      updatedAt: true,
      category: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  let filteredProducts = products;
  if (lowStock === 'true') {
    filteredProducts = products.filter(p => p.trackInventory && p.stockQuantity <= p.lowStockAlert);
  }

  // Calculate totals
  const totalInventoryValue = rc(filteredProducts.reduce(
    (sum, p) => sum + rc(p.cost * p.stockQuantity),
    0
  ));

  const totalRetailValue = rc(filteredProducts.reduce(
    (sum, p) => sum + rc(p.price * p.stockQuantity),
    0
  ));

  const lowStockCount = filteredProducts.filter(
    (p) => p.stockQuantity <= p.lowStockAlert
  ).length;

  res.json({
    success: true,
    data: {
      products: filteredProducts,
      summary: {
        totalProducts: filteredProducts.length,
        totalInventoryValue: Math.round(totalInventoryValue * 100) / 100,
        totalRetailValue: Math.round(totalRetailValue * 100) / 100,
        potentialProfit: Math.round((totalRetailValue - totalInventoryValue) * 100) / 100,
        lowStockCount,
      },
    },
  });
});

/**
 * Get employee performance report
 * GET /api/reports/employees
 */
export const getEmployeeReport = asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;

  const where: any = {
    status: SaleStatus.COMPLETED,
  };

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) {
    where.createdAt = dateFilter;
  }

  const sales = await prisma.sale.findMany({
    where,
    select: {
      userId: true,
      total: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });

  // Group by employee
  const employeeStats = sales.reduce((acc: any, sale) => {
    const userId = sale.userId;

    if (!acc[userId]) {
      acc[userId] = {
        user: sale.user,
        totalSales: 0,
        transactionCount: 0,
        averageOrderValue: 0,
      };
    }

    acc[userId].totalSales += sale.total;
    acc[userId].transactionCount += 1;

    return acc;
  }, {});

  // Calculate averages
  const employeeData = Object.values(employeeStats).map((stat: any) => ({
    ...stat,
    totalSales: Math.round(stat.totalSales * 100) / 100,
    averageOrderValue: Math.round((stat.totalSales / stat.transactionCount) * 100) / 100,
  }));

  res.json({
    success: true,
    data: employeeData,
  });
});

/**
 * Get product sales report
 * GET /api/reports/products
 */
export const getProductSalesReport = asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate, limit = 20 } = req.query;

  const where: any = {
    sale: {
      status: SaleStatus.COMPLETED,
    },
  };

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) {
    where.sale = {
      ...where.sale,
      createdAt: dateFilter,
    };
  }

  const saleItems = await prisma.saleItem.findMany({
    where,
    select: {
      productId: true,
      productName: true,
      quantity: true,
      total: true,
      tax: true,
      product: {
        select: {
          sku: true,
          price: true,
          cost: true,
        },
      },
    },
  });

  // Group by product
  const productStats = saleItems.reduce((acc: any, item) => {
    const productId = item.productId;

    if (!acc[productId]) {
      acc[productId] = {
        productId,
        productName: item.productName,
        sku: item.product.sku,
        quantitySold: 0,
        revenue: 0,
        profit: 0,
      };
    }

    acc[productId].quantitySold += item.quantity;
    acc[productId].revenue = rc(acc[productId].revenue + item.total);
    // Profit from what was actually charged (discounted, pre-tax), not the current list price
    acc[productId].profit = rc(
      acc[productId].profit + rc((item.total - item.tax) - item.product.cost * item.quantity)
    );

    return acc;
  }, {});

  // Convert to array and sort
  const productData = Object.values(productStats)
    .sort((a: any, b: any) => b.revenue - a.revenue)
    .slice(0, parseInt(limit as string));

  res.json({
    success: true,
    data: productData,
  });
});

/**
 * Get expense report
 * GET /api/reports/expenses
 */
export const getExpenseReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, category, status, locationId } = req.query;

  const where: any = {};

  if (category) {
    where.category = parseListFilter(category);
  }

  if (status) {
    where.status = parseListFilter(status);
  } else {
    // Consistent with the overall report: rejected expenses aren't real spend
    where.status = { not: ExpenseStatus.REJECTED };
  }

  if (locationId) {
    where.locationId = locationId;
  }

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) {
    where.expenseDate = dateFilter;
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      location: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      expenseDate: 'desc',
    },
  });

  // Calculate summary
  const totalExpenses = rc(expenses.reduce((sum, exp) => sum + exp.amount, 0));
  const pendingExpenses = rc(expenses
    .filter((exp) => exp.status === 'PENDING')
    .reduce((sum, exp) => sum + exp.amount, 0));
  const paidExpenses = rc(expenses
    .filter((exp) => exp.status === 'PAID')
    .reduce((sum, exp) => sum + exp.amount, 0));

  // Group by category
  const byCategory = expenses.reduce((acc: any, exp) => {
    if (!acc[exp.category]) {
      acc[exp.category] = {
        category: exp.category,
        count: 0,
        total: 0,
      };
    }
    acc[exp.category].count++;
    acc[exp.category].total = rc(acc[exp.category].total + exp.amount);
    return acc;
  }, {});

  const categorySummary = Object.values(byCategory).map((cat: any) => ({
    ...cat,
    percentage: totalExpenses > 0 ? rc((cat.total / totalExpenses) * 100) : 0,
  }));

  // Find top category
  const topCategory = categorySummary.reduce((top: any, cat: any) => {
    return !top || cat.total > top.total ? cat : top;
  }, null);

  // Calculate average daily expense
  const daysInPeriod = startDate && endDate
    ? Math.max(
        1,
        Math.ceil(
          (new Date(endDate as string).getTime() - new Date(startDate as string).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 30;
  const avgDailyExpense = rc(totalExpenses / daysInPeriod);

  res.json({
    success: true,
    data: {
      expenses,
      summary: {
        totalExpenses,
        pendingExpenses,
        paidExpenses,
        byCategory: categorySummary,
        topCategory: topCategory?.category || 'N/A',
        avgDailyExpense,
      },
    },
  });
});

/**
 * Export sales report to CSV
 * GET /api/reports/sales/export/csv
 */
export const exportSalesCSV = asyncHandler(async (req: Request, res: Response) => {
  const { Parser } = require('json2csv');
  const {
    startDate,
    endDate,
    locationId,
    userId,
    paymentMethod,
    customerId,
    status,
  } = req.query;

  const where: any = {
    status: parseListFilter(status) ?? SaleStatus.COMPLETED,
  };

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) {
    where.createdAt = dateFilter;
  }

  if (locationId) where.locationId = locationId;
  const userFilter = parseListFilter(userId);
  if (userFilter) where.userId = userFilter;
  const paymentMethodFilter = parseListFilter(paymentMethod);
  if (paymentMethodFilter) where.paymentMethod = paymentMethodFilter;
  if (customerId) where.customerId = customerId;

  const sales = await prisma.sale.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true } },
      customer: { select: { firstName: true, lastName: true } },
      location: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Transform data for CSV
  const csvData = sales.map((sale) => ({
    'Sale Number': sale.saleNumber,
    'Date': sale.createdAt.toISOString().split('T')[0],
    'Time': sale.createdAt.toISOString().split('T')[1].split('.')[0],
    'Employee': sale.user ? `${sale.user.firstName} ${sale.user.lastName}` : 'N/A',
    'Customer': sale.customer ? `${sale.customer.firstName} ${sale.customer.lastName}` : 'Walk-in',
    'Payment Method': sale.paymentMethod,
    'Subtotal': sale.subtotal.toFixed(2),
    'Tax': sale.tax.toFixed(2),
    'Discount': sale.discount.toFixed(2),
    'Total': sale.total.toFixed(2),
    'Status': sale.status,
    'Location': sale.location?.name || '',
  }));

  const parser = new Parser();
  const csv = parser.parse(csvData);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=sales-export.csv');
  res.send(csv);
});

// ─── PDF Helper Functions ───
const PRIMARY_COLOR = '#2563eb';
const DARK_COLOR = '#1e293b';
const MUTED_COLOR = '#64748b';
const BORDER_COLOR = '#e2e8f0';
const BG_LIGHT = '#f8fafc';

function drawPdfHeader(doc: any, title: string, subtitle?: string) {
  // Blue banner
  doc.rect(0, 0, doc.page.width, 80).fill(PRIMARY_COLOR);
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
    .text(title, 50, 25, { align: 'left' });
  doc.fontSize(10).font('Helvetica')
    .text('POS System', 50, 52, { align: 'left' });
  doc.fontSize(9)
    .text(`Generated: ${new Date().toLocaleString()}`, doc.page.width - 250, 30, { width: 200, align: 'right' });
  if (subtitle) {
    doc.text(subtitle, doc.page.width - 250, 45, { width: 200, align: 'right' });
  }
  doc.fillColor(DARK_COLOR);
  doc.y = 100;
}

function drawSummaryBox(doc: any, items: { label: string; value: string }[], columns = 3) {
  const startX = 50;
  const boxWidth = (doc.page.width - 100) / columns;
  const startY = doc.y;

  doc.rect(startX, startY, doc.page.width - 100, 60).fill(BG_LIGHT).stroke(BORDER_COLOR);

  items.forEach((item, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = startX + col * boxWidth + 15;
    const y = startY + row * 30 + 10;

    doc.fillColor(MUTED_COLOR).fontSize(8).font('Helvetica').text(item.label, x, y);
    doc.fillColor(DARK_COLOR).fontSize(13).font('Helvetica-Bold').text(item.value, x, y + 11);
  });

  doc.fillColor(DARK_COLOR);
  doc.y = startY + Math.ceil(items.length / columns) * 30 + 20;
}

function drawSectionTitle(doc: any, title: string) {
  doc.moveDown(0.5);
  doc.fillColor(PRIMARY_COLOR).fontSize(12).font('Helvetica-Bold').text(title);
  doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor(PRIMARY_COLOR).lineWidth(1.5).stroke();
  doc.fillColor(DARK_COLOR).moveDown(0.5);
}

function drawTableHeader(doc: any, columns: { label: string; x: number; width: number; align?: string }[]) {
  const y = doc.y;
  doc.rect(50, y, doc.page.width - 100, 18).fill('#eef2ff');
  doc.fillColor(DARK_COLOR).fontSize(8).font('Helvetica-Bold');
  columns.forEach(col => {
    doc.text(col.label, col.x, y + 5, { width: col.width, align: (col.align as any) || 'left' });
  });
  doc.fillColor(DARK_COLOR).font('Helvetica');
  doc.y = y + 20;
}

function drawTableRow(doc: any, columns: { value: string; x: number; width: number; align?: string }[], index: number) {
  const y = doc.y;
  if (index % 2 === 0) {
    doc.rect(50, y - 1, doc.page.width - 100, 15).fill(BG_LIGHT);
  }
  doc.fillColor(DARK_COLOR).fontSize(8).font('Helvetica');
  columns.forEach(col => {
    doc.text(col.value, col.x, y + 2, { width: col.width, align: (col.align as any) || 'left' });
  });
  doc.y = y + 15;
}

function checkPageBreak(doc: any, needed = 50) {
  if (doc.y > doc.page.height - needed) {
    doc.addPage();
    return true;
  }
  return false;
}

function drawFooter(doc: any) {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(MUTED_COLOR).fontSize(7).font('Helvetica');
    doc.text(`Page ${i + 1} of ${pages.count}`, 50, doc.page.height - 30, { align: 'center', width: doc.page.width - 100 });
  }
}

/**
 * Export sales report to PDF
 * GET /api/reports/sales/export/pdf
 */
export const exportSalesPDF = asyncHandler(async (req: Request, res: Response) => {
  const PDFDocument = require('pdfkit');
  const {
    startDate,
    endDate,
    locationId,
    userId,
    paymentMethod,
    customerId,
    status,
  } = req.query;

  const where: any = {
    status: parseListFilter(status) ?? SaleStatus.COMPLETED,
  };

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) {
    where.createdAt = dateFilter;
  }

  if (locationId) where.locationId = locationId;
  const userFilter = parseListFilter(userId);
  if (userFilter) where.userId = userFilter;
  const paymentMethodFilter = parseListFilter(paymentMethod);
  if (paymentMethodFilter) where.paymentMethod = paymentMethodFilter;
  if (customerId) where.customerId = customerId;

  const sales = await prisma.sale.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true } },
      customer: { select: { firstName: true, lastName: true } },
      items: { include: { product: { select: { name: true, sku: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate summary
  const totalSales = rc(sales.reduce((sum, sale) => sum + sale.total, 0));
  const totalTax = rc(sales.reduce((sum, sale) => sum + sale.tax, 0));
  const totalDiscount = rc(sales.reduce((sum, sale) => sum + sale.discount, 0));
  const avgOrderValue = sales.length > 0 ? rc(totalSales / sales.length) : 0;
  // Sale totals already have the discount applied — only back out tax here
  const netRevenue = rc(totalSales - totalTax);

  // Payment method breakdown
  const paymentBreakdown = sales.reduce((acc: any, sale) => {
    const method = sale.paymentMethod;
    if (!acc[method]) acc[method] = { count: 0, total: 0 };
    acc[method].count++;
    acc[method].total = rc(acc[method].total + sale.total);
    return acc;
  }, {});

  // Daily breakdown
  const dailyBreakdown = sales.reduce((acc: any, sale) => {
    const day = sale.createdAt.toISOString().split('T')[0];
    if (!acc[day]) acc[day] = { count: 0, total: 0 };
    acc[day].count++;
    acc[day].total = rc(acc[day].total + sale.total);
    return acc;
  }, {});

  // Create PDF
  const doc = new PDFDocument({ margin: 50, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=sales-report.pdf');

  doc.pipe(res);

  // Header
  const period = (startDate || endDate) ? `${startDate || 'All'} to ${endDate || 'All'}` : 'All Time';
  drawPdfHeader(doc, 'Sales Report', `Period: ${period}`);

  // Summary boxes
  drawSummaryBox(doc, [
    { label: 'TOTAL REVENUE', value: `$${totalSales.toFixed(2)}` },
    { label: 'TRANSACTIONS', value: sales.length.toString() },
    { label: 'AVG ORDER VALUE', value: `$${avgOrderValue.toFixed(2)}` },
    { label: 'NET REVENUE', value: `$${netRevenue.toFixed(2)}` },
    { label: 'TOTAL TAX', value: `$${totalTax.toFixed(2)}` },
    { label: 'TOTAL DISCOUNT', value: `$${totalDiscount.toFixed(2)}` },
  ]);

  // Payment breakdown
  drawSectionTitle(doc, 'Payment Method Breakdown');
  const pmCols = [
    { label: 'METHOD', x: 60, width: 150 },
    { label: 'TRANSACTIONS', x: 220, width: 100, align: 'right' },
    { label: 'AMOUNT', x: 340, width: 120, align: 'right' },
    { label: '% OF TOTAL', x: 470, width: 80, align: 'right' },
  ];
  drawTableHeader(doc, pmCols);
  Object.entries(paymentBreakdown).forEach(([method, data]: [string, any], i) => {
    drawTableRow(doc, [
      { value: method, x: 60, width: 150 },
      { value: data.count.toString(), x: 220, width: 100, align: 'right' },
      { value: `$${data.total.toFixed(2)}`, x: 340, width: 120, align: 'right' },
      { value: `${(data.total / totalSales * 100).toFixed(1)}%`, x: 470, width: 80, align: 'right' },
    ], i);
  });

  // Daily summary
  const dailyEntries = Object.entries(dailyBreakdown).sort();
  if (dailyEntries.length > 1) {
    doc.moveDown(1);
    drawSectionTitle(doc, 'Daily Summary');
    const dayCols = [
      { label: 'DATE', x: 60, width: 150 },
      { label: 'TRANSACTIONS', x: 220, width: 100, align: 'right' },
      { label: 'REVENUE', x: 340, width: 120, align: 'right' },
    ];
    drawTableHeader(doc, dayCols);
    dailyEntries.forEach(([day, data]: [string, any], i) => {
      checkPageBreak(doc);
      drawTableRow(doc, [
        { value: day, x: 60, width: 150 },
        { value: data.count.toString(), x: 220, width: 100, align: 'right' },
        { value: `$${data.total.toFixed(2)}`, x: 340, width: 120, align: 'right' },
      ], i);
    });
  }

  // Transaction details
  doc.addPage();
  drawSectionTitle(doc, `Transaction Details (${sales.length} records)`);

  const saleCols = [
    { label: 'SALE #', x: 50, width: 75 },
    { label: 'DATE', x: 125, width: 70 },
    { label: 'CUSTOMER', x: 195, width: 90 },
    { label: 'EMPLOYEE', x: 285, width: 80 },
    { label: 'PAYMENT', x: 365, width: 55 },
    { label: 'TAX', x: 420, width: 55, align: 'right' },
    { label: 'TOTAL', x: 475, width: 70, align: 'right' },
  ];
  drawTableHeader(doc, saleCols);

  sales.forEach((sale, i) => {
    checkPageBreak(doc, 20);
    drawTableRow(doc, [
      { value: sale.saleNumber, x: 50, width: 75 },
      { value: sale.createdAt.toISOString().split('T')[0], x: 125, width: 70 },
      { value: sale.customer ? `${sale.customer.firstName} ${sale.customer.lastName}` : 'Walk-in', x: 195, width: 90 },
      { value: sale.user ? `${sale.user.firstName} ${sale.user.lastName}` : 'N/A', x: 285, width: 80 },
      { value: sale.paymentMethod, x: 365, width: 55 },
      { value: `$${sale.tax.toFixed(2)}`, x: 420, width: 55, align: 'right' },
      { value: `$${sale.total.toFixed(2)}`, x: 475, width: 70, align: 'right' },
    ], i);
  });

  drawFooter(doc);
  doc.end();
});

/**
 * Export inventory report to CSV
 * GET /api/reports/inventory/export/csv
 */
export const exportInventoryCSV = asyncHandler(async (req: Request, res: Response) => {
  const { Parser } = require('json2csv');
  const { categoryId, lowStock, minPrice, maxPrice } = req.query;

  const where: any = { isActive: true };

  if (categoryId) where.categoryId = categoryId;

  if (minPrice || maxPrice) {
    where.price = {};
    if (minPrice) where.price.gte = parseFloat(minPrice as string);
    if (maxPrice) where.price.lte = parseFloat(maxPrice as string);
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      category: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });

  let filteredProducts = products;
  if (lowStock === 'true') {
    filteredProducts = products.filter(p => p.trackInventory && p.stockQuantity <= p.lowStockAlert);
  }

  // Transform data for CSV
  const csvData = filteredProducts.map((product) => ({
    'SKU': product.sku,
    'Name': product.name,
    'Category': product.category?.name || 'Uncategorized',
    'Stock Quantity': product.stockQuantity,
    'Low Stock Alert': product.lowStockAlert,
    'Cost': product.cost.toFixed(2),
    'Price': product.price.toFixed(2),
    'Inventory Value': (product.cost * product.stockQuantity).toFixed(2),
    'Retail Value': (product.price * product.stockQuantity).toFixed(2),
    'Barcode': product.barcode || '',
    'Track Inventory': product.trackInventory ? 'Yes' : 'No',
    'Is Active': product.isActive ? 'Yes' : 'No',
  }));

  const parser = new Parser();
  const csv = parser.parse(csvData);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=inventory-export.csv');
  res.send(csv);
});

/**
 * Export inventory report to PDF
 * GET /api/reports/inventory/export/pdf
 */
export const exportInventoryPDF = asyncHandler(async (req: Request, res: Response) => {
  const PDFDocument = require('pdfkit');
  const { categoryId, lowStock, minPrice, maxPrice } = req.query;

  const where: any = { isActive: true };

  if (categoryId) where.categoryId = categoryId;

  if (minPrice || maxPrice) {
    where.price = {};
    if (minPrice) where.price.gte = parseFloat(minPrice as string);
    if (maxPrice) where.price.lte = parseFloat(maxPrice as string);
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      category: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });

  let filteredProducts = products;
  if (lowStock === 'true') {
    filteredProducts = products.filter(p => p.trackInventory && p.stockQuantity <= p.lowStockAlert);
  }

  // Calculate summary
  const totalInventoryValue = rc(filteredProducts.reduce((sum, p) => sum + rc(p.cost * p.stockQuantity), 0));
  const totalRetailValue = rc(filteredProducts.reduce((sum, p) => sum + rc(p.price * p.stockQuantity), 0));
  const potentialProfit = rc(totalRetailValue - totalInventoryValue);
  const lowStockCount = filteredProducts.filter((p) => p.trackInventory && p.stockQuantity <= p.lowStockAlert).length;
  const outOfStockCount = filteredProducts.filter((p) => p.trackInventory && p.stockQuantity === 0).length;
  const margin = totalRetailValue > 0 ? rc((potentialProfit / totalRetailValue) * 100) : 0;

  // Category breakdown
  const categoryBreakdown = filteredProducts.reduce((acc: any, product) => {
    const catName = product.category?.name || 'Uncategorized';
    if (!acc[catName]) acc[catName] = { count: 0, costValue: 0, retailValue: 0, stock: 0 };
    acc[catName].count++;
    acc[catName].costValue = rc(acc[catName].costValue + rc(product.cost * product.stockQuantity));
    acc[catName].retailValue = rc(acc[catName].retailValue + rc(product.price * product.stockQuantity));
    acc[catName].stock += product.stockQuantity;
    return acc;
  }, {});

  const doc = new PDFDocument({ margin: 50, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=inventory-report.pdf');
  doc.pipe(res);

  drawPdfHeader(doc, 'Inventory Report');

  drawSummaryBox(doc, [
    { label: 'TOTAL PRODUCTS', value: filteredProducts.length.toString() },
    { label: 'INVENTORY VALUE (COST)', value: `$${totalInventoryValue.toFixed(2)}` },
    { label: 'RETAIL VALUE', value: `$${totalRetailValue.toFixed(2)}` },
    { label: 'POTENTIAL PROFIT', value: `$${potentialProfit.toFixed(2)}` },
    { label: 'PROFIT MARGIN', value: `${margin.toFixed(1)}%` },
    { label: 'LOW / OUT OF STOCK', value: `${lowStockCount} / ${outOfStockCount}` },
  ]);

  // Category breakdown table
  drawSectionTitle(doc, 'Inventory by Category');
  const catCols = [
    { label: 'CATEGORY', x: 50, width: 120 },
    { label: 'PRODUCTS', x: 170, width: 60, align: 'right' },
    { label: 'TOTAL STOCK', x: 230, width: 70, align: 'right' },
    { label: 'COST VALUE', x: 310, width: 80, align: 'right' },
    { label: 'RETAIL VALUE', x: 400, width: 80, align: 'right' },
  ];
  drawTableHeader(doc, catCols);
  Object.entries(categoryBreakdown).forEach(([cat, data]: [string, any], i) => {
    drawTableRow(doc, [
      { value: cat, x: 50, width: 120 },
      { value: data.count.toString(), x: 170, width: 60, align: 'right' },
      { value: data.stock.toString(), x: 230, width: 70, align: 'right' },
      { value: `$${data.costValue.toFixed(2)}`, x: 310, width: 80, align: 'right' },
      { value: `$${data.retailValue.toFixed(2)}`, x: 400, width: 80, align: 'right' },
    ], i);
  });

  // Product details
  doc.addPage();
  drawSectionTitle(doc, `Product Details (${filteredProducts.length} items)`);

  const prodCols = [
    { label: 'SKU', x: 50, width: 70 },
    { label: 'PRODUCT', x: 120, width: 130 },
    { label: 'CATEGORY', x: 250, width: 75 },
    { label: 'STOCK', x: 325, width: 45, align: 'right' },
    { label: 'COST', x: 370, width: 55, align: 'right' },
    { label: 'PRICE', x: 425, width: 55, align: 'right' },
    { label: 'VALUE', x: 480, width: 65, align: 'right' },
  ];
  drawTableHeader(doc, prodCols);

  filteredProducts.forEach((product, i) => {
    checkPageBreak(doc, 20);
    const isLow = product.trackInventory && product.stockQuantity <= product.lowStockAlert;
    const stockStr = isLow ? `${product.stockQuantity} !` : product.stockQuantity.toString();
    drawTableRow(doc, [
      { value: product.sku, x: 50, width: 70 },
      { value: product.name.substring(0, 25), x: 120, width: 130 },
      { value: (product.category?.name || 'N/A').substring(0, 15), x: 250, width: 75 },
      { value: stockStr, x: 325, width: 45, align: 'right' },
      { value: `$${product.cost.toFixed(2)}`, x: 370, width: 55, align: 'right' },
      { value: `$${product.price.toFixed(2)}`, x: 425, width: 55, align: 'right' },
      { value: `$${(product.cost * product.stockQuantity).toFixed(2)}`, x: 480, width: 65, align: 'right' },
    ], i);
  });

  drawFooter(doc);
  doc.end();
});

/**
 * Get employee sales breakdown
 * GET /api/reports/employee-sales
 */
export const getEmployeeSalesBreakdown = asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { startDate, endDate, locationId } = req.query;

  const where: any = { status: SaleStatus.COMPLETED };

  // SUPER_ADMIN can filter by location; others auto-scoped
  if (authReq.user?.role === 'SUPER_ADMIN' && locationId) {
    where.locationId = locationId;
  } else if (authReq.user?.locationId) {
    where.locationId = authReq.user.locationId;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  // Group sales by userId
  const salesByEmployee = await prisma.sale.groupBy({
    by: ['userId'],
    where,
    _sum: { total: true },
    _count: true,
    _avg: { total: true },
  });

  // Fetch user details
  const userIds = salesByEmployee.map((s: any) => s.userId).filter(Boolean);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true, email: true, role: true },
  });
  const userMap = new Map(users.map(u => [u.id, u]));

  const data = salesByEmployee
    .filter((entry: any) => entry.userId)
    .map((entry: any) => ({
      user: userMap.get(entry.userId) || { id: entry.userId, firstName: 'Unknown', lastName: '', email: '', role: 'CASHIER' },
      totalRevenue: Math.round((entry._sum.total || 0) * 100) / 100,
      transactionCount: entry._count,
      avgTransaction: Math.round((entry._avg.total || 0) * 100) / 100,
    }))
    .sort((a: any, b: any) => b.totalRevenue - a.totalRevenue);

  res.json({ success: true, data });
});

/**
 * Inventory-log types that represent shrinkage (stock lost, not sold or moved).
 * Matches the reason list in the frontend StockAdjustmentModal.
 */
const SHRINKAGE_TYPES = ['DAMAGED', 'LOST', 'THEFT', 'EXPIRED', 'WASTE', 'OTHER'];

/**
 * Stock health report: dead stock, sell-through, and shrinkage over a window
 * GET /api/reports/stock-health?days=30
 */
export const getStockHealthReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || 30), 10) || 30, 7), 365);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const locationId = req.user?.locationId || undefined;
  const revenueStatuses = { in: [SaleStatus.COMPLETED, SaleStatus.REFUNDED] };

  const [products, soldRows, lastSaleRows, shrinkLogs] = await Promise.all([
    // Active tracked catalog (misc pseudo-product excluded)
    prisma.product.findMany({
      where: {
        isActive: true,
        trackInventory: true,
        sku: { not: 'MISC-001' },
        ...(locationId ? { locationId } : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        cost: true,
        stockQuantity: true,
        category: { select: { id: true, name: true } },
      },
    }),
    // Units sold per product inside the window
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        createdAt: { gte: cutoff },
        sale: { status: revenueStatuses, ...(locationId ? { locationId } : {}) },
      },
      _sum: { quantity: true },
    }),
    // Most recent sale per product (all time) — shown for dead-stock rows
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { status: revenueStatuses, ...(locationId ? { locationId } : {}) } },
      _max: { createdAt: true },
    }),
    // Loss-reason stock removals inside the window
    prisma.inventoryLog.findMany({
      where: {
        type: { in: SHRINKAGE_TYPES },
        quantity: { lt: 0 },
        createdAt: { gte: cutoff },
        ...(locationId ? { product: { locationId } } : {}),
      },
      include: { product: { select: { name: true, sku: true, cost: true, price: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const soldMap = new Map(soldRows.map((r) => [r.productId, r._sum.quantity || 0]));
  const lastSaleMap = new Map(lastSaleRows.map((r) => [r.productId, r._max.createdAt]));

  // ---- Dead stock: on hand but zero sales in the window ----
  const deadStock = products
    .filter((p) => p.stockQuantity > 0 && !soldMap.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      categoryName: p.category?.name || 'Uncategorized',
      stockQuantity: p.stockQuantity,
      price: p.price,
      cost: p.cost,
      stockValue: rc(p.cost * p.stockQuantity),
      retailValue: rc(p.price * p.stockQuantity),
      lastSoldAt: lastSaleMap.get(p.id) || null,
    }))
    .sort((a, b) => b.stockValue - a.stockValue)
    .slice(0, 200);

  const deadStockTotals = {
    products: deadStock.length,
    units: deadStock.reduce((s, p) => s + p.stockQuantity, 0),
    stockValue: rc(deadStock.reduce((s, p) => s + p.stockValue, 0)),
    retailValue: rc(deadStock.reduce((s, p) => s + p.retailValue, 0)),
  };

  // ---- Sell-through by category: sold / (sold + on hand) ----
  const byCategory = new Map<
    string,
    { categoryName: string; unitsSold: number; stockOnHand: number }
  >();
  for (const p of products) {
    const key = p.category?.id || 'uncategorized';
    const entry = byCategory.get(key) || {
      categoryName: p.category?.name || 'Uncategorized',
      unitsSold: 0,
      stockOnHand: 0,
    };
    entry.unitsSold += soldMap.get(p.id) || 0;
    entry.stockOnHand += p.stockQuantity;
    byCategory.set(key, entry);
  }
  const sellThrough = Array.from(byCategory.values())
    .filter((c) => c.unitsSold > 0 || c.stockOnHand > 0)
    .map((c) => ({
      ...c,
      sellThroughPct:
        c.unitsSold + c.stockOnHand > 0
          ? rc((c.unitsSold / (c.unitsSold + c.stockOnHand)) * 100)
          : 0,
    }))
    .sort((a, b) => b.sellThroughPct - a.sellThroughPct);

  const totalSold = sellThrough.reduce((s, c) => s + c.unitsSold, 0);
  const totalStock = sellThrough.reduce((s, c) => s + c.stockOnHand, 0);
  const sellThroughOverall =
    totalSold + totalStock > 0 ? rc((totalSold / (totalSold + totalStock)) * 100) : 0;

  // ---- Shrinkage grouped by reason ----
  const byReason = new Map<
    string,
    { reason: string; entries: number; units: number; costValue: number; retailValue: number }
  >();
  for (const log of shrinkLogs) {
    const units = Math.abs(log.quantity);
    const entry = byReason.get(log.type) || {
      reason: log.type,
      entries: 0,
      units: 0,
      costValue: 0,
      retailValue: 0,
    };
    entry.entries += 1;
    entry.units += units;
    entry.costValue += (log.product?.cost || 0) * units;
    entry.retailValue += (log.product?.price || 0) * units;
    byReason.set(log.type, entry);
  }
  const shrinkageByReason = Array.from(byReason.values())
    .map((r) => ({ ...r, costValue: rc(r.costValue), retailValue: rc(r.retailValue) }))
    .sort((a, b) => b.costValue - a.costValue);

  const shrinkageTotals = {
    entries: shrinkLogs.length,
    units: shrinkageByReason.reduce((s, r) => s + r.units, 0),
    costValue: rc(shrinkageByReason.reduce((s, r) => s + r.costValue, 0)),
    retailValue: rc(shrinkageByReason.reduce((s, r) => s + r.retailValue, 0)),
  };

  const shrinkageRecent = shrinkLogs.slice(0, 25).map((log) => ({
    id: log.id,
    productName: log.product?.name || 'Unknown',
    sku: log.product?.sku || '',
    reason: log.type,
    units: Math.abs(log.quantity),
    costValue: rc((log.product?.cost || 0) * Math.abs(log.quantity)),
    notes: log.notes,
    createdAt: log.createdAt,
  }));

  res.json({
    success: true,
    data: {
      days,
      deadStock: { totals: deadStockTotals, products: deadStock },
      sellThrough: { overallPct: sellThroughOverall, unitsSold: totalSold, stockOnHand: totalStock, byCategory: sellThrough },
      shrinkage: { totals: shrinkageTotals, byReason: shrinkageByReason, recent: shrinkageRecent },
    },
  });
});

/**
 * Send the end-of-day digest email now (also returns the narrative for preview)
 * POST /api/reports/daily-digest/send
 */
export const sendDailyDigestNow = asyncHandler(async (_req: AuthRequest, res: Response) => {
  // Imported lazily so test runs don't construct the Anthropic client path eagerly
  const { sendDailyDigest } = await import('../services/dailyDigest.service');
  const result = await sendDailyDigest();

  res.json({
    success: true,
    data: result,
    message:
      result.recipients.length > 0
        ? `Digest sent to ${result.recipients.join(', ')}`
        : 'No recipients configured — set DAILY_DIGEST_EMAILS or add admin users',
  });
});

/**
 * Age verification audit trail (compliance record for inspections)
 * GET /api/reports/age-verifications
 */
export const getAgeVerifications = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = 1, limit = 25, startDate, endDate } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {};
  if (req.user?.locationId) where.locationId = req.user.locationId;
  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) where.createdAt = dateFilter;

  const [logs, total] = await Promise.all([
    prisma.ageVerificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.ageVerificationLog.count({ where }),
  ]);

  // Resolve cashier names without a schema relation
  const userIds = [...new Set(logs.map((l) => l.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const userMap = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

  res.json({
    success: true,
    data: logs.map((l) => ({ ...l, cashierName: userMap.get(l.userId) || 'Unknown' })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * Tobacco / manufacturer scan-data export.
 *
 * Scan-data programs (Altria, RJR/ITG buydown reporting) pay retailers for
 * submitting weekly line-item sales of program categories. This produces the
 * generic wide-format CSV those portals ingest: one row per sold line item
 * with UPC, quantity, pricing, and promo attribution.
 *
 * GET /api/reports/scan-data/export/csv?startDate&endDate&categoryIds=a,b
 */
export const exportScanDataCSV = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { Parser } = require('json2csv');
  const { startDate, endDate, categoryIds } = req.query;

  const categoryFilter = parseListFilter(categoryIds);
  if (!categoryFilter) {
    res.status(400).json({ success: false, error: 'Select at least one category to export' });
    return;
  }

  const dateFilter = createDateFilter(startDate as string, endDate as string);

  const items = await prisma.saleItem.findMany({
    where: {
      ...(dateFilter ? { createdAt: dateFilter } : {}),
      product: { categoryId: categoryFilter },
      sale: {
        status: { in: [SaleStatus.COMPLETED, SaleStatus.REFUNDED] },
        ...(req.user?.locationId ? { locationId: req.user.locationId } : {}),
      },
    },
    include: {
      product: { select: { barcode: true, categoryId: true, category: { select: { name: true } } } },
      sale: {
        select: {
          saleNumber: true,
          createdAt: true,
          location: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const csvData = items.map((item) => {
    const dt = new Date(item.sale.createdAt);
    return {
      'Transaction Date': dt.toISOString().slice(0, 10),
      'Transaction Time': dt.toTimeString().slice(0, 8),
      'Store ID': item.sale.location?.id || '',
      'Store Name': item.sale.location?.name || '',
      'Transaction ID': item.sale.saleNumber,
      'UPC': item.product?.barcode || item.sku,
      'SKU': item.sku,
      'Item Description': item.productName,
      'Category': item.product?.category?.name || '',
      'Quantity': item.quantity,
      'Unit Price': item.price.toFixed(2),
      'Total Discount': item.discount.toFixed(2),
      'Promotion Flag': item.promotionDiscount > 0 ? 'Y' : 'N',
      'Promotion Name': item.promotionName || '',
      'Final Price': (item.total - item.tax).toFixed(2),
      'Tax': item.tax.toFixed(2),
    };
  });

  const parser = new Parser();
  const csv = parser.parse(
    csvData.length > 0
      ? csvData
      : [{ 'Transaction Date': '', 'Transaction Time': '', 'Store ID': '', 'Store Name': '', 'Transaction ID': '', 'UPC': '', 'SKU': '', 'Item Description': '', 'Category': '', 'Quantity': '', 'Unit Price': '', 'Total Discount': '', 'Promotion Flag': '', 'Promotion Name': '', 'Final Price': '', 'Tax': '' }]
  );

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=scan-data-${startDate || 'all'}-${endDate || 'all'}.csv`
  );
  res.send(csv);
});
