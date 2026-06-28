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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const twoWeeksAgo = new Date(weekAgo);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 7);

  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  // Run all queries concurrently
  const [
    todaySales,
    yesterdaySales,
    weekSales,
    prevWeekSales,
    monthSales,
    products,
    totalCustomers,
    activeEmployees,
  ] = await Promise.all([
    // Today's sales
    prisma.sale.aggregate({
      where: { createdAt: { gte: today }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
      _count: true,
    }),
    // Yesterday's sales (for trend)
    prisma.sale.aggregate({
      where: { createdAt: { gte: yesterday, lt: today }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
      _count: true,
    }),
    // This week sales
    prisma.sale.aggregate({
      where: { createdAt: { gte: weekAgo }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
    }),
    // Previous week (for trend)
    prisma.sale.aggregate({
      where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
    }),
    // Month sales
    prisma.sale.aggregate({
      where: { createdAt: { gte: monthAgo }, status: SaleStatus.COMPLETED },
      _sum: { total: true },
    }),
    // Low stock products
    prisma.product.findMany({
      where: { trackInventory: true, isActive: true },
      select: { stockQuantity: true, lowStockAlert: true },
    }),
    // Total customers
    prisma.customer.count({ where: { isActive: true } }),
    // Active employees
    prisma.user.count({ where: { isActive: true } }),
  ]);

  const lowStockCount = products.filter(p => p.stockQuantity <= p.lowStockAlert).length;

  const avgOrderValue = todaySales._count > 0
    ? (todaySales._sum.total || 0) / todaySales._count
    : 0;

  // Trend: % change vs comparison period
  const calcTrend = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100 * 10) / 10;
  };

  const todayTotal = todaySales._sum.total || 0;
  const yesterdayTotal = yesterdaySales._sum.total || 0;
  const weekTotal = weekSales._sum.total || 0;
  const prevWeekTotal = prevWeekSales._sum.total || 0;

  res.json({
    success: true,
    data: {
      todaySales: todayTotal,
      todayTransactions: todaySales._count,
      yesterdaySales: yesterdayTotal,
      todayTrend: calcTrend(todayTotal, yesterdayTotal),
      weekSales: weekTotal,
      prevWeekSales: prevWeekTotal,
      weekTrend: calcTrend(weekTotal, prevWeekTotal),
      monthSales: monthSales._sum.total || 0,
      lowStockProducts: lowStockCount,
      totalCustomers,
      activeEmployees,
      averageOrderValue: Math.round(avgOrderValue * 100) / 100,
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
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

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

  // Bucket into hours
  const hourMap: Record<number, number> = {};
  for (let h = 0; h < 12; h++) {
    const hourStart = new Date(twelveHoursAgo.getTime() + h * 60 * 60 * 1000);
    hourMap[hourStart.getHours()] = 0;
  }
  hourlySales.forEach((sale) => {
    const h = new Date(sale.createdAt).getHours();
    hourMap[h] = (hourMap[h] || 0) + (sale.total || 0);
  });

  const hourlyData = Object.entries(hourMap).map(([hour, total]) => ({
    hour: parseInt(hour),
    label: `${parseInt(hour) % 12 || 12}${parseInt(hour) < 12 ? 'am' : 'pm'}`,
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
    _sum: { quantity: true, price: true },
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
      revenue: Math.round((p._sum.price || 0) * (p._sum.quantity || 0) * 100) / 100,
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
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate summary
  const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0);
  const totalTax = sales.reduce((sum, sale) => sum + sale.tax, 0);
  const totalDiscount = sales.reduce((sum, sale) => sum + sale.discount, 0);
  const avgOrderValue = sales.length > 0 ? totalSales / sales.length : 0;

  // Payment method breakdown
  const paymentBreakdown = sales.reduce((acc: any, sale) => {
    const method = sale.paymentMethod;
    acc[method] = (acc[method] || 0) + sale.total;
    return acc;
  }, {});

  // Create PDF
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=sales-report.pdf');

  doc.pipe(res);

  // Header
  doc.fontSize(20).text('Sales Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });
  if (startDate || endDate) {
    const dateRange = `${startDate || 'All'} to ${endDate || 'All'}`;
    doc.text(`Period: ${dateRange}`, { align: 'center' });
  }
  doc.moveDown(2);

  // Summary
  doc.fontSize(14).text('Summary', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Total Sales: $${totalSales.toFixed(2)}`);
  doc.text(`Number of Transactions: ${sales.length}`);
  doc.text(`Average Order Value: $${avgOrderValue.toFixed(2)}`);
  doc.text(`Total Tax: $${totalTax.toFixed(2)}`);
  doc.text(`Total Discount: $${totalDiscount.toFixed(2)}`);
  doc.moveDown(1);
  doc.text('Sales by Payment Method:', { underline: true });
  Object.keys(paymentBreakdown).forEach((method) => {
    doc.text(`  ${method}: $${paymentBreakdown[method].toFixed(2)}`);
  });
  doc.moveDown(2);

  // Sales Details
  doc.fontSize(14).text('Sales Details', { underline: true });
  doc.moveDown(0.5);

  sales.slice(0, 100).forEach((sale, index) => {
    if (index > 0) doc.moveDown(1);

    doc.fontSize(10).text(`${sale.saleNumber}`, { continued: true });
    doc.text(` - ${sale.createdAt.toLocaleDateString()}`, { continued: true });
    doc.text(` - $${sale.total.toFixed(2)}`);
    doc.fontSize(9).text(`  Employee: ${sale.user ? `${sale.user.firstName} ${sale.user.lastName}` : 'N/A'}`);
    doc.text(`  Customer: ${sale.customer ? `${sale.customer.firstName} ${sale.customer.lastName}` : 'Walk-in'}`);
    doc.text(`  Payment: ${sale.paymentMethod}`);

    // Add page break if needed
    if (index % 15 === 14 && index < sales.length - 1) {
      doc.addPage();
    }
  });

  if (sales.length > 100) {
    doc.moveDown(2);
    doc.fontSize(9).text(`Note: Showing first 100 of ${sales.length} sales. Export to CSV for complete data.`, {
      align: 'center',
      italics: true
    });
  }

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
  const totalInventoryValue = filteredProducts.reduce(
    (sum, p) => sum + (p.cost * p.stockQuantity),
    0
  );
  const totalRetailValue = filteredProducts.reduce(
    (sum, p) => sum + (p.price * p.stockQuantity),
    0
  );
  const potentialProfit = totalRetailValue - totalInventoryValue;
  const lowStockCount = filteredProducts.filter(
    (p) => p.trackInventory && p.stockQuantity <= p.lowStockAlert
  ).length;

  // Category breakdown
  const categoryBreakdown = filteredProducts.reduce((acc: any, product) => {
    const catName = product.category?.name || 'Uncategorized';
    if (!acc[catName]) {
      acc[catName] = { count: 0, value: 0 };
    }
    acc[catName].count++;
    acc[catName].value += product.cost * product.stockQuantity;
    return acc;
  }, {});

  // Create PDF
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=inventory-report.pdf');

  doc.pipe(res);

  // Header
  doc.fontSize(20).text('Inventory Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });
  doc.moveDown(2);

  // Summary
  doc.fontSize(14).text('Summary', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Total Products: ${filteredProducts.length}`);
  doc.text(`Total Inventory Value: $${totalInventoryValue.toFixed(2)}`);
  doc.text(`Total Retail Value: $${totalRetailValue.toFixed(2)}`);
  doc.text(`Potential Profit: $${potentialProfit.toFixed(2)}`);
  doc.text(`Low Stock Items: ${lowStockCount}`);
  doc.moveDown(1);
  doc.text('Inventory by Category:', { underline: true });
  Object.keys(categoryBreakdown).forEach((category) => {
    const data = categoryBreakdown[category];
    doc.text(`  ${category}: ${data.count} items - $${data.value.toFixed(2)}`);
  });
  doc.moveDown(2);

  // Product Details
  doc.fontSize(14).text('Product Details', { underline: true });
  doc.moveDown(0.5);

  filteredProducts.slice(0, 80).forEach((product, index) => {
    if (index > 0) doc.moveDown(0.8);

    const inventoryValue = product.cost * product.stockQuantity;
    const isLowStock = product.trackInventory && product.stockQuantity <= product.lowStockAlert;

    doc.fontSize(10).text(`${product.sku} - ${product.name}`, { continued: true });
    if (isLowStock) {
      doc.fillColor('red').text(' [LOW STOCK]', { continued: false });
      doc.fillColor('black');
    } else {
      doc.text('');
    }

    doc.fontSize(9).text(`  Category: ${product.category?.name || 'N/A'} | Stock: ${product.stockQuantity} | Price: $${product.price.toFixed(2)}`);
    doc.text(`  Inventory Value: $${inventoryValue.toFixed(2)}`);

    // Add page break if needed
    if (index % 20 === 19 && index < filteredProducts.length - 1) {
      doc.addPage();
    }
  });

  if (filteredProducts.length > 80) {
    doc.moveDown(2);
    doc.fontSize(9).text(`Note: Showing first 80 of ${filteredProducts.length} products. Export to CSV for complete data.`, {
      align: 'center',
      italics: true
    });
  }

  doc.end();
});
