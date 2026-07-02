import { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import prisma from '../config/database';
import { SaleStatus, ExpenseStatus } from '@prisma/client';
import { AuthRequest } from '../types';
import { createDateFilter } from '../utils/dateFilter.util';

/**
 * Get overall business report - comprehensive metrics for small-mid size businesses
 * GET /api/reports/overall
 */
export const getOverallReport = asyncHandler(async (_req: Request, res: Response) => {
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

  // Today's sales
  const todaySales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: today, lte: endOfToday },
      status: SaleStatus.COMPLETED,
    },
    _sum: { total: true, tax: true, discount: true, subtotal: true },
    _count: true,
  });

  // This week's sales
  const weekSales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: weekAgo },
      status: SaleStatus.COMPLETED,
    },
    _sum: { total: true, tax: true, discount: true },
    _count: true,
  });

  // Previous week's sales (for comparison)
  const prevWeekSales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: previousWeek, lt: weekAgo },
      status: SaleStatus.COMPLETED,
    },
    _sum: { total: true },
    _count: true,
  });

  // This month's sales
  const monthSales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: monthAgo },
      status: SaleStatus.COMPLETED,
    },
    _sum: { total: true, tax: true, discount: true },
    _count: true,
  });

  // Previous month's sales (for comparison)
  const prevMonthSales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: previousMonth, lt: monthAgo },
      status: SaleStatus.COMPLETED,
    },
    _sum: { total: true },
    _count: true,
  });

  // This year's sales
  const yearSales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: yearAgo },
      status: SaleStatus.COMPLETED,
    },
    _sum: { total: true, tax: true, discount: true },
    _count: true,
  });

  // Calculate growth percentages
  const weeklyGrowth = prevWeekSales._sum.total
    ? (((weekSales._sum.total || 0) - (prevWeekSales._sum.total || 0)) / (prevWeekSales._sum.total || 1)) * 100
    : 0;

  const monthlyGrowth = prevMonthSales._sum.total
    ? (((monthSales._sum.total || 0) - (prevMonthSales._sum.total || 0)) / (prevMonthSales._sum.total || 1)) * 100
    : 0;

  // ==================== PROFIT & COST ANALYSIS ====================

  // Get all completed sales with items for profit calculation
  const salesWithItems = await prisma.sale.findMany({
    where: {
      createdAt: { gte: monthAgo },
      status: SaleStatus.COMPLETED,
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
      totalCOGS += (item.product?.cost || 0) * item.quantity;
    });
  });

  const grossProfit = (monthSales._sum.total || 0) - totalCOGS;
  const grossMargin = monthSales._sum.total ? (grossProfit / (monthSales._sum.total || 1)) * 100 : 0;

  // Get expenses for net profit (include all statuses except REJECTED)
  const monthExpenses = await prisma.expense.aggregate({
    where: {
      expenseDate: { gte: monthAgo },
      status: { notIn: [ExpenseStatus.REJECTED] },
    },
    _sum: { amount: true },
    _count: true,
  });

  const netProfit = grossProfit - (monthExpenses._sum.amount || 0);
  const netMargin = monthSales._sum.total ? (netProfit / (monthSales._sum.total || 1)) * 100 : 0;

  // ==================== CUSTOMER INSIGHTS ====================

  // Total customers
  const totalCustomers = await prisma.customer.count({
    where: { isActive: true },
  });

  // New customers this month
  const newCustomers = await prisma.customer.count({
    where: {
      createdAt: { gte: monthAgo },
      isActive: true,
    },
  });

  // Returning customers (with more than one visit)
  const returningCustomers = await prisma.customer.count({
    where: {
      visitCount: { gt: 1 },
      isActive: true,
    },
  });

  // Top customers by spend
  const topCustomers = await prisma.customer.findMany({
    where: { isActive: true },
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
    },
    _avg: { totalSpent: true },
  });

  // ==================== INVENTORY HEALTH ====================

  // All products summary
  const allProducts = await prisma.product.findMany({
    where: { isActive: true },
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
  const totalInventoryValue = allProducts.reduce((sum, p) => sum + (p.cost * p.stockQuantity), 0);
  const totalRetailValue = allProducts.reduce((sum, p) => sum + (p.price * p.stockQuantity), 0);

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
    acc[catName].revenue += item.total;
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
    },
    _sum: { total: true },
    _count: true,
  });

  const paymentBreakdown = paymentMethodStats.map((pm) => ({
    method: pm.paymentMethod,
    total: pm._sum.total || 0,
    count: pm._count,
    percentage: monthSales._sum.total
      ? ((pm._sum.total || 0) / (monthSales._sum.total || 1)) * 100
      : 0,
  }));

  // ==================== EMPLOYEE PERFORMANCE ====================

  const employeeStats = await prisma.sale.groupBy({
    by: ['userId'],
    where: {
      createdAt: { gte: monthAgo },
      status: SaleStatus.COMPLETED,
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
      avgOrderValue: stat._count > 0 ? (stat._sum.total || 0) / stat._count : 0,
    };
  }).sort((a, b) => b.totalSales - a.totalSales);

  // ==================== EXPENSE BREAKDOWN ====================

  const expensesByCategory = await prisma.expense.groupBy({
    by: ['category'],
    where: {
      expenseDate: { gte: monthAgo },
      status: { notIn: [ExpenseStatus.REJECTED] },
    },
    _sum: { amount: true },
    _count: true,
  });

  const expenseBreakdown = expensesByCategory.map((exp) => ({
    category: exp.category,
    total: exp._sum.amount || 0,
    count: exp._count,
    percentage: monthExpenses._sum.amount
      ? ((exp._sum.amount || 0) / (monthExpenses._sum.amount || 1)) * 100
      : 0,
  })).sort((a, b) => b.total - a.total);

  // ==================== DAILY SALES TREND (last 30 days) ====================

  const dailySales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: monthAgo },
      status: SaleStatus.COMPLETED,
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
      salesByDay[dateKey].sales += sale.total;
      salesByDay[dateKey].transactions += 1;
    }
  });

  const dailySalesTrend = Object.values(salesByDay);

  // ==================== HOURLY SALES PATTERN (today) ====================

  const todaySalesDetail = await prisma.sale.findMany({
    where: {
      createdAt: { gte: today, lte: endOfToday },
      status: SaleStatus.COMPLETED,
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
    hourlyPattern[hour].sales += sale.total;
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

  const refundsThisMonth = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: monthAgo },
      status: SaleStatus.REFUNDED,
    },
    _sum: { total: true },
    _count: true,
  });

  const voidsThisMonth = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: monthAgo },
      status: SaleStatus.VOIDED,
    },
    _sum: { total: true },
    _count: true,
  });

  // ==================== COMPILE RESPONSE ====================

  res.json({
    success: true,
    data: {
      // Revenue Overview
      revenue: {
        today: {
          total: todaySales._sum.total || 0,
          transactions: todaySales._count,
          tax: todaySales._sum.tax || 0,
          discount: todaySales._sum.discount || 0,
        },
        week: {
          total: weekSales._sum.total || 0,
          transactions: weekSales._count,
          growth: Math.round(weeklyGrowth * 100) / 100,
        },
        month: {
          total: monthSales._sum.total || 0,
          transactions: monthSales._count,
          growth: Math.round(monthlyGrowth * 100) / 100,
        },
        year: {
          total: yearSales._sum.total || 0,
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

      // Refunds & Voids
      refundsAndVoids: {
        refunds: {
          total: refundsThisMonth._sum.total || 0,
          count: refundsThisMonth._count,
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
export const getDashboardMetrics = asyncHandler(async (_req: Request, res: Response) => {
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
      where: { createdAt: { gte: today }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { createdAt: { gte: yesterday, lt: today }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { createdAt: { gte: weekAgo }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
    }),
    prisma.sale.aggregate({
      where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
    }),
    prisma.sale.aggregate({
      where: { createdAt: { gte: monthAgo }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
    }),
    prisma.sale.aggregate({
      where: { createdAt: { gte: prevMonthStart, lt: monthAgo }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
    }),
    // Today's refunds
    prisma.sale.aggregate({
      where: { createdAt: { gte: today }, status: SaleStatus.REFUNDED },
      _sum: { total: true },
      _count: true,
    }),
    // Low stock products (with names)
    prisma.product.findMany({
      where: { trackInventory: true, isActive: true },
      select: { id: true, name: true, sku: true, stockQuantity: true, lowStockAlert: true },
    }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.customer.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: true } }),
    // Recent 5 sales
    prisma.sale.findMany({
      where: { status: SaleStatus.COMPLETED },
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
      where: { createdAt: { gte: today }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
      _count: true,
    }),
  ]);

  const lowStockItems = lowStockProducts
    .filter(p => p.stockQuantity <= p.lowStockAlert)
    .sort((a, b) => a.stockQuantity - b.stockQuantity)
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
      todayRefunds: todayRefunds._sum.total || 0,
      todayRefundCount: todayRefunds._count,
      lowStockCount: lowStockItems.length,
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
  const locationId = authReq.user?.locationId;

  const now = new Date();
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const locationFilter = locationId ? { locationId } : {};

  // Hourly sales for the last 12 hours
  const hourlySales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: twelveHoursAgo },
      status: SaleStatus.COMPLETED,
      ...locationFilter,
    },
    select: { createdAt: true, total: true },
  });

  // Bucket into hours using UTC so the client can convert to local time
  const hourMap: Record<number, number> = {};
  for (let h = 0; h < 12; h++) {
    const hourStart = new Date(twelveHoursAgo.getTime() + h * 60 * 60 * 1000);
    hourMap[hourStart.getUTCHours()] = 0;
  }
  hourlySales.forEach((sale) => {
    const h = new Date(sale.createdAt).getUTCHours();
    hourMap[h] = (hourMap[h] || 0) + (sale.total || 0);
  });

  const hourlyData = Object.entries(hourMap).map(([hour, total]) => ({
    hour: parseInt(hour),
    utcHour: parseInt(hour),
    total: Math.round(total * 100) / 100,
  }));

  // Top 5 products today
  const topProducts = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: {
      sale: {
        createdAt: { gte: today },
        status: SaleStatus.COMPLETED,
        ...locationFilter,
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
    status: status || SaleStatus.COMPLETED,
  };

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) {
    where.createdAt = dateFilter;
  }

  if (locationId) where.locationId = locationId;
  if (userId) where.userId = userId;
  if (paymentMethod) where.paymentMethod = paymentMethod;
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
  const summary = {
    totalSales: sales.reduce((sum, sale) => sum + sale.total, 0),
    totalTransactions: sales.length,
    averageOrderValue: sales.length > 0
      ? sales.reduce((sum, sale) => sum + sale.total, 0) / sales.length
      : 0,
    totalTax: sales.reduce((sum, sale) => sum + sale.tax, 0),
    totalDiscount: sales.reduce((sum, sale) => sum + sale.discount, 0),
  };

  // Payment method breakdown
  const paymentBreakdown = sales.reduce((acc: any, sale) => {
    const method = sale.paymentMethod;
    if (!acc[method]) {
      acc[method] = { count: 0, total: 0 };
    }
    acc[method].count++;
    acc[method].total += sale.total;
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
      acc[employeeId].total += sale.total;
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
  const totalInventoryValue = filteredProducts.reduce(
    (sum, p) => sum + (p.cost * p.stockQuantity),
    0
  );

  const totalRetailValue = filteredProducts.reduce(
    (sum, p) => sum + (p.price * p.stockQuantity),
    0
  );

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
    acc[productId].revenue += item.total;
    acc[productId].profit += (item.product.price - item.product.cost) * item.quantity;

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
    where.category = category;
  }

  if (status) {
    where.status = status;
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
  const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const pendingExpenses = expenses
    .filter((exp) => exp.status === 'PENDING')
    .reduce((sum, exp) => sum + exp.amount, 0);
  const paidExpenses = expenses
    .filter((exp) => exp.status === 'PAID')
    .reduce((sum, exp) => sum + exp.amount, 0);

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
    acc[exp.category].total += exp.amount;
    return acc;
  }, {});

  const categorySummary = Object.values(byCategory).map((cat: any) => ({
    ...cat,
    percentage: totalExpenses > 0 ? (cat.total / totalExpenses) * 100 : 0,
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
  const avgDailyExpense = totalExpenses / daysInPeriod;

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
    status: status || SaleStatus.COMPLETED,
  };

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) {
    where.createdAt = dateFilter;
  }

  if (locationId) where.locationId = locationId;
  if (userId) where.userId = userId;
  if (paymentMethod) where.paymentMethod = paymentMethod;
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
    status: status || SaleStatus.COMPLETED,
  };

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) {
    where.createdAt = dateFilter;
  }

  if (locationId) where.locationId = locationId;
  if (userId) where.userId = userId;
  if (paymentMethod) where.paymentMethod = paymentMethod;
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
  const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0);
  const totalTax = sales.reduce((sum, sale) => sum + sale.tax, 0);
  const totalDiscount = sales.reduce((sum, sale) => sum + sale.discount, 0);
  const avgOrderValue = sales.length > 0 ? totalSales / sales.length : 0;
  const netRevenue = totalSales - totalTax - totalDiscount;

  // Payment method breakdown
  const paymentBreakdown = sales.reduce((acc: any, sale) => {
    const method = sale.paymentMethod;
    if (!acc[method]) acc[method] = { count: 0, total: 0 };
    acc[method].count++;
    acc[method].total += sale.total;
    return acc;
  }, {});

  // Daily breakdown
  const dailyBreakdown = sales.reduce((acc: any, sale) => {
    const day = sale.createdAt.toISOString().split('T')[0];
    if (!acc[day]) acc[day] = { count: 0, total: 0 };
    acc[day].count++;
    acc[day].total += sale.total;
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
  const totalInventoryValue = filteredProducts.reduce((sum, p) => sum + (p.cost * p.stockQuantity), 0);
  const totalRetailValue = filteredProducts.reduce((sum, p) => sum + (p.price * p.stockQuantity), 0);
  const potentialProfit = totalRetailValue - totalInventoryValue;
  const lowStockCount = filteredProducts.filter((p) => p.trackInventory && p.stockQuantity <= p.lowStockAlert).length;
  const outOfStockCount = filteredProducts.filter((p) => p.trackInventory && p.stockQuantity === 0).length;
  const margin = totalRetailValue > 0 ? ((potentialProfit / totalRetailValue) * 100) : 0;

  // Category breakdown
  const categoryBreakdown = filteredProducts.reduce((acc: any, product) => {
    const catName = product.category?.name || 'Uncategorized';
    if (!acc[catName]) acc[catName] = { count: 0, costValue: 0, retailValue: 0, stock: 0 };
    acc[catName].count++;
    acc[catName].costValue += product.cost * product.stockQuantity;
    acc[catName].retailValue += product.price * product.stockQuantity;
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
