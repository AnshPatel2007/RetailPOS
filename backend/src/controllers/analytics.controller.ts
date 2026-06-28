import { Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';

/**
 * Get comparison analytics (YoY, MoM, WoW)
 * GET /api/analytics/comparison
 */
export const getComparisonAnalytics = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const now = new Date();

  // Current periods
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // Previous periods
  const prevDayStart = new Date(todayStart);
  prevDayStart.setDate(prevDayStart.getDate() - 1);
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYearStart = new Date(now.getFullYear() - 1, 0, 1);
  const prevYearEnd = new Date(now.getFullYear() - 1, 11, 31);

  // Same period last year
  const lastYearSameDayStart = new Date(todayStart);
  lastYearSameDayStart.setFullYear(lastYearSameDayStart.getFullYear() - 1);
  const lastYearSameWeekStart = new Date(weekStart);
  lastYearSameWeekStart.setFullYear(lastYearSameWeekStart.getFullYear() - 1);
  const lastYearSameMonthStart = new Date(monthStart);
  lastYearSameMonthStart.setFullYear(lastYearSameMonthStart.getFullYear() - 1);

  // Helper function to get sales for a period
  const getSalesForPeriod = async (start: Date, end: Date) => {
    const result = await prisma.sale.aggregate({
      where: {
        createdAt: { gte: start, lt: end },
        status: 'COMPLETED',
      },
      _sum: { total: true },
      _count: { id: true },
    });
    return {
      revenue: result._sum.total || 0,
      profit: 0, // Would need to calculate from items
      transactions: result._count.id || 0,
    };
  };

  // Get all period data in parallel
  const [
    today, yesterday, lastYearSameDay,
    thisWeek, lastWeek, lastYearSameWeek,
    thisMonth, lastMonth, lastYearSameMonth,
    thisYear, lastYear
  ] = await Promise.all([
    getSalesForPeriod(todayStart, now),
    getSalesForPeriod(prevDayStart, todayStart),
    getSalesForPeriod(lastYearSameDayStart, new Date(lastYearSameDayStart.getTime() + 86400000)),
    getSalesForPeriod(weekStart, now),
    getSalesForPeriod(prevWeekStart, weekStart),
    getSalesForPeriod(lastYearSameWeekStart, new Date(lastYearSameWeekStart.getTime() + 7 * 86400000)),
    getSalesForPeriod(monthStart, now),
    getSalesForPeriod(prevMonthStart, monthStart),
    getSalesForPeriod(lastYearSameMonthStart, new Date(lastYearSameMonthStart.getFullYear(), lastYearSameMonthStart.getMonth() + 1, 1)),
    getSalesForPeriod(yearStart, now),
    getSalesForPeriod(prevYearStart, prevYearEnd),
  ]);

  // Calculate growth percentages
  const calcGrowth = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  res.json({
    success: true,
    data: {
      daily: {
        current: today,
        previous: yesterday,
        lastYear: lastYearSameDay,
        growthVsPrevious: calcGrowth(today.revenue, yesterday.revenue),
        growthVsLastYear: calcGrowth(today.revenue, lastYearSameDay.revenue),
      },
      weekly: {
        current: thisWeek,
        previous: lastWeek,
        lastYear: lastYearSameWeek,
        growthVsPrevious: calcGrowth(thisWeek.revenue, lastWeek.revenue),
        growthVsLastYear: calcGrowth(thisWeek.revenue, lastYearSameWeek.revenue),
      },
      monthly: {
        current: thisMonth,
        previous: lastMonth,
        lastYear: lastYearSameMonth,
        growthVsPrevious: calcGrowth(thisMonth.revenue, lastMonth.revenue),
        growthVsLastYear: calcGrowth(thisMonth.revenue, lastYearSameMonth.revenue),
      },
      yearly: {
        current: thisYear,
        previous: lastYear,
        growthVsPrevious: calcGrowth(thisYear.revenue, lastYear.revenue),
      },
    },
  });
});

/**
 * Get ABC inventory analysis
 * GET /api/analytics/abc-analysis
 */
export const getABCAnalysis = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { days = '90' } = req.query;
  const daysNum = parseInt(days as string);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysNum);

  // Get product sales data
  const productSales = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: {
      sale: {
        createdAt: { gte: startDate },
        status: 'COMPLETED',
      },
    },
    _sum: {
      total: true,
      quantity: true,
    },
    _count: { id: true },
  });

  // Get product details
  const products = await prisma.product.findMany({
    where: {
      id: { in: productSales.map(ps => ps.productId) },
    },
    select: {
      id: true,
      name: true,
      sku: true,
      stockQuantity: true,
      cost: true,
      price: true,
      category: { select: { name: true } },
    },
  });

  // Calculate metrics and sort by revenue
  const productMetrics = productSales.map(ps => {
    const product = products.find(p => p.id === ps.productId);
    const revenue = ps._sum.total || 0;
    const quantity = ps._sum.quantity || 0;
    const inventoryValue = (product?.stockQuantity || 0) * (product?.cost || 0);

    return {
      id: ps.productId,
      name: product?.name || 'Unknown',
      sku: product?.sku || '',
      category: product?.category?.name || 'Uncategorized',
      revenue,
      quantity,
      transactions: ps._count.id || 0,
      stockQuantity: product?.stockQuantity || 0,
      inventoryValue,
      turnoverRate: inventoryValue > 0 ? revenue / inventoryValue : 0,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  // Calculate cumulative percentages
  const totalRevenue = productMetrics.reduce((sum, p) => sum + p.revenue, 0);
  let cumulativeRevenue = 0;

  const analyzedProducts = productMetrics.map(product => {
    cumulativeRevenue += product.revenue;
    const cumulativePercentage = totalRevenue > 0 ? (cumulativeRevenue / totalRevenue) * 100 : 0;

    let classification: 'A' | 'B' | 'C';
    if (cumulativePercentage <= 80) {
      classification = 'A';
    } else if (cumulativePercentage <= 95) {
      classification = 'B';
    } else {
      classification = 'C';
    }

    return {
      ...product,
      revenuePercentage: totalRevenue > 0 ? (product.revenue / totalRevenue) * 100 : 0,
      cumulativePercentage,
      classification,
    };
  });

  // Summary statistics
  const classA = analyzedProducts.filter(p => p.classification === 'A');
  const classB = analyzedProducts.filter(p => p.classification === 'B');
  const classC = analyzedProducts.filter(p => p.classification === 'C');

  res.json({
    success: true,
    data: {
      products: analyzedProducts,
      summary: {
        totalProducts: analyzedProducts.length,
        totalRevenue,
        classA: {
          count: classA.length,
          percentage: analyzedProducts.length > 0 ? (classA.length / analyzedProducts.length) * 100 : 0,
          revenue: classA.reduce((sum, p) => sum + p.revenue, 0),
          revenuePercentage: totalRevenue > 0 ? (classA.reduce((sum, p) => sum + p.revenue, 0) / totalRevenue) * 100 : 0,
        },
        classB: {
          count: classB.length,
          percentage: analyzedProducts.length > 0 ? (classB.length / analyzedProducts.length) * 100 : 0,
          revenue: classB.reduce((sum, p) => sum + p.revenue, 0),
          revenuePercentage: totalRevenue > 0 ? (classB.reduce((sum, p) => sum + p.revenue, 0) / totalRevenue) * 100 : 0,
        },
        classC: {
          count: classC.length,
          percentage: analyzedProducts.length > 0 ? (classC.length / analyzedProducts.length) * 100 : 0,
          revenue: classC.reduce((sum, p) => sum + p.revenue, 0),
          revenuePercentage: totalRevenue > 0 ? (classC.reduce((sum, p) => sum + p.revenue, 0) / totalRevenue) * 100 : 0,
        },
      },
      period: {
        days: daysNum,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
    },
  });
});

/**
 * Get product performance matrix
 * GET /api/analytics/product-matrix
 */
export const getProductPerformanceMatrix = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { days = '30' } = req.query;
  const daysNum = parseInt(days as string);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysNum);

  // Get sales data by product
  const salesData = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: {
      sale: {
        createdAt: { gte: startDate },
        status: 'COMPLETED',
      },
    },
    _sum: {
      quantity: true,
      total: true,
    },
  });

  // Get product details
  const productIds = salesData.map(s => s.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { category: { select: { name: true } } },
  });

  // Calculate metrics
  const productMetrics = salesData.map(sale => {
    const product = products.find(p => p.id === sale.productId);
    const revenue = sale._sum.total || 0;
    const quantity = sale._sum.quantity || 0;
    // Calculate profit from cost difference
    const profit = product ? quantity * (product.price - product.cost) : 0;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const velocity = quantity / daysNum;

    return {
      id: sale.productId,
      name: product?.name || 'Unknown',
      sku: product?.sku || '',
      category: product?.category?.name || 'Uncategorized',
      revenue,
      profit,
      quantity,
      margin,
      velocity,
      cost: product?.cost || 0,
      price: product?.price || 0,
      stock: product?.stockQuantity || 0,
    };
  });

  // Calculate quartiles for velocity and margin
  const velocities = productMetrics.map(p => p.velocity).sort((a, b) => a - b);
  const margins = productMetrics.map(p => p.margin).sort((a, b) => a - b);

  const medianVelocity = velocities[Math.floor(velocities.length / 2)] || 0;
  const medianMargin = margins[Math.floor(margins.length / 2)] || 0;

  // Classify products into quadrants
  const matrixProducts = productMetrics.map(product => {
    let quadrant: 'star' | 'cash_cow' | 'question_mark' | 'dog';

    if (product.velocity >= medianVelocity && product.margin >= medianMargin) {
      quadrant = 'star';
    } else if (product.velocity >= medianVelocity && product.margin < medianMargin) {
      quadrant = 'cash_cow';
    } else if (product.velocity < medianVelocity && product.margin >= medianMargin) {
      quadrant = 'question_mark';
    } else {
      quadrant = 'dog';
    }

    return { ...product, quadrant };
  });

  // Group by quadrant
  const stars = matrixProducts.filter(p => p.quadrant === 'star');
  const cashCows = matrixProducts.filter(p => p.quadrant === 'cash_cow');
  const questionMarks = matrixProducts.filter(p => p.quadrant === 'question_mark');
  const dogs = matrixProducts.filter(p => p.quadrant === 'dog');

  res.json({
    success: true,
    data: {
      products: matrixProducts,
      quadrants: {
        star: {
          label: 'Stars',
          description: 'High velocity, High margin - Keep investing',
          count: stars.length,
          products: stars.sort((a, b) => b.revenue - a.revenue).slice(0, 10),
        },
        cash_cow: {
          label: 'Cash Cows',
          description: 'High velocity, Low margin - Optimize pricing',
          count: cashCows.length,
          products: cashCows.sort((a, b) => b.revenue - a.revenue).slice(0, 10),
        },
        question_mark: {
          label: 'Question Marks',
          description: 'Low velocity, High margin - Increase promotion',
          count: questionMarks.length,
          products: questionMarks.sort((a, b) => b.revenue - a.revenue).slice(0, 10),
        },
        dog: {
          label: 'Dogs',
          description: 'Low velocity, Low margin - Consider discontinuing',
          count: dogs.length,
          products: dogs.sort((a, b) => b.revenue - a.revenue).slice(0, 10),
        },
      },
      thresholds: {
        medianVelocity,
        medianMargin,
      },
      period: {
        days: daysNum,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
    },
  });
});

/**
 * Get sales forecast
 * GET /api/analytics/forecast
 */
export const getSalesForecast = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { forecastDays = '30' } = req.query;
  const forecastDaysNum = parseInt(forecastDays as string);

  // Get historical daily sales for the past 90 days
  const historicalDays = 90;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - historicalDays);

  // Get daily sales using findMany and manual grouping
  const sales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: startDate },
      status: 'COMPLETED',
    },
    select: {
      createdAt: true,
      total: true,
    },
  });

  // Group by date
  const dailyMap = new Map<string, { revenue: number; transactions: number }>();
  sales.forEach(sale => {
    const dateKey = sale.createdAt.toISOString().split('T')[0];
    const existing = dailyMap.get(dateKey) || { revenue: 0, transactions: 0 };
    dailyMap.set(dateKey, {
      revenue: existing.revenue + sale.total,
      transactions: existing.transactions + 1,
    });
  });

  const dailySales = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Calculate trends
  const revenueValues = dailySales.map(d => d.revenue);
  const transactionValues = dailySales.map(d => d.transactions);

  // Simple linear regression for trend
  const calculateTrend = (values: number[]) => {
    const n = values.length;
    if (n < 2) return { slope: 0, intercept: 0 };

    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, val, i) => sum + i * val, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope: isNaN(slope) ? 0 : slope, intercept: isNaN(intercept) ? 0 : intercept };
  };

  const revenueTrend = calculateTrend(revenueValues);
  const transactionTrend = calculateTrend(transactionValues);

  // Calculate day-of-week patterns
  const dayOfWeekPatterns: { [key: number]: number[] } = {
    0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []
  };

  dailySales.forEach(day => {
    const dayOfWeek = new Date(day.date).getDay();
    dayOfWeekPatterns[dayOfWeek].push(day.revenue);
  });

  const dayOfWeekMultipliers: { [key: number]: number } = {};
  const avgRevenue = revenueValues.length > 0
    ? revenueValues.reduce((a, b) => a + b, 0) / revenueValues.length
    : 1;

  for (let i = 0; i < 7; i++) {
    const dayAvg = dayOfWeekPatterns[i].length > 0
      ? dayOfWeekPatterns[i].reduce((a, b) => a + b, 0) / dayOfWeekPatterns[i].length
      : avgRevenue;
    dayOfWeekMultipliers[i] = avgRevenue > 0 ? dayAvg / avgRevenue : 1;
  }

  // Generate forecast
  const forecast = [];
  const n = revenueValues.length;

  for (let i = 0; i < forecastDaysNum; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i + 1);
    const dayOfWeek = date.getDay();

    // Base prediction from trend
    const baseRevenue = revenueTrend.intercept + revenueTrend.slope * (n + i);
    const baseTransactions = transactionTrend.intercept + transactionTrend.slope * (n + i);

    // Apply day-of-week multiplier
    const adjustedRevenue = Math.max(0, baseRevenue * dayOfWeekMultipliers[dayOfWeek]);
    const adjustedTransactions = Math.max(0, Math.round(baseTransactions * dayOfWeekMultipliers[dayOfWeek]));

    // Calculate confidence interval
    const variance = n > 2 ? revenueValues.reduce((sum, val, idx) => {
      const predicted = revenueTrend.intercept + revenueTrend.slope * idx;
      return sum + Math.pow(val - predicted, 2);
    }, 0) / (n - 2) : 0;
    const stdError = Math.sqrt(variance);

    forecast.push({
      date: date.toISOString().split('T')[0],
      dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek],
      revenue: Math.round(adjustedRevenue * 100) / 100,
      transactions: adjustedTransactions,
      confidenceLow: Math.max(0, Math.round((adjustedRevenue - 1.96 * stdError) * 100) / 100),
      confidenceHigh: Math.round((adjustedRevenue + 1.96 * stdError) * 100) / 100,
    });
  }

  // Summary statistics
  const totalForecastRevenue = forecast.reduce((sum, f) => sum + f.revenue, 0);
  const avgDailyForecast = forecastDaysNum > 0 ? totalForecastRevenue / forecastDaysNum : 0;
  const expectedGrowth = avgRevenue > 0 ? ((avgDailyForecast - avgRevenue) / avgRevenue) * 100 : 0;

  res.json({
    success: true,
    data: {
      forecast,
      summary: {
        totalForecastRevenue: Math.round(totalForecastRevenue * 100) / 100,
        avgDailyForecast: Math.round(avgDailyForecast * 100) / 100,
        historicalAvgDaily: Math.round(avgRevenue * 100) / 100,
        expectedGrowth: Math.round(expectedGrowth * 100) / 100,
        totalForecastTransactions: forecast.reduce((sum, f) => sum + f.transactions, 0),
      },
      trends: {
        revenueSlope: Math.round(revenueTrend.slope * 100) / 100,
        transactionSlope: Math.round(transactionTrend.slope * 100) / 100,
        direction: revenueTrend.slope > 0 ? 'upward' : revenueTrend.slope < 0 ? 'downward' : 'flat',
      },
      dayOfWeekPatterns: Object.entries(dayOfWeekMultipliers).map(([day, multiplier]) => ({
        day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parseInt(day)],
        multiplier: Math.round(multiplier * 100) / 100,
      })),
      historicalPeriod: {
        days: historicalDays,
        dataPoints: dailySales.length,
      },
    },
  });
});

/**
 * Get customer insights
 * GET /api/analytics/customer-insights
 */
export const getCustomerInsights = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Get customer segments by recency
  const [activeCustomers, atRiskCustomers, lostCustomers] = await Promise.all([
    prisma.customer.count({
      where: { lastVisitAt: { gte: thirtyDaysAgo } },
    }),
    prisma.customer.count({
      where: {
        lastVisitAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
      },
    }),
    prisma.customer.count({
      where: {
        OR: [
          { lastVisitAt: { lt: sixtyDaysAgo } },
          { lastVisitAt: null },
        ],
      },
    }),
  ]);

  // Get customer value segments
  const customers = await prisma.customer.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      totalSpent: true,
      visitCount: true,
      lastVisitAt: true,
      createdAt: true,
    },
  });

  // Calculate value tiers
  const sortedBySpend = [...customers].sort((a, b) => b.totalSpent - a.totalSpent);
  const totalCustomers = customers.length;

  const vipThreshold = sortedBySpend[Math.floor(totalCustomers * 0.1)]?.totalSpent || 0;
  const regularThreshold = sortedBySpend[Math.floor(totalCustomers * 0.4)]?.totalSpent || 0;

  const vipCustomers = customers.filter(c => c.totalSpent >= vipThreshold);
  const regularCustomers = customers.filter(c => c.totalSpent >= regularThreshold && c.totalSpent < vipThreshold);
  const occasionalCustomers = customers.filter(c => c.totalSpent < regularThreshold);

  // New vs returning analysis (last 30 days)
  const newCustomersCount = await prisma.customer.count({
    where: { createdAt: { gte: thirtyDaysAgo } },
  });

  const returningCustomerSales = await prisma.sale.count({
    where: {
      createdAt: { gte: thirtyDaysAgo },
      status: 'COMPLETED',
      customer: {
        createdAt: { lt: thirtyDaysAgo },
      },
    },
  });

  const newCustomerSales = await prisma.sale.count({
    where: {
      createdAt: { gte: thirtyDaysAgo },
      status: 'COMPLETED',
      customer: {
        createdAt: { gte: thirtyDaysAgo },
      },
    },
  });

  // Customer lifetime value distribution
  const avgLifetimeValue = totalCustomers > 0
    ? customers.reduce((sum, c) => sum + c.totalSpent, 0) / totalCustomers
    : 0;
  const avgOrderValue = await prisma.sale.aggregate({
    where: {
      status: 'COMPLETED',
      customerId: { not: null },
    },
    _avg: { total: true },
  });

  // Purchase frequency analysis
  const avgVisitCount = totalCustomers > 0
    ? customers.reduce((sum, c) => sum + c.visitCount, 0) / totalCustomers
    : 0;

  // Top customers
  const topCustomers = sortedBySpend.slice(0, 10).map(c => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim() || 'Unknown',
    email: c.email,
    totalSpent: c.totalSpent,
    visitCount: c.visitCount,
    avgOrderValue: c.visitCount > 0 ? c.totalSpent / c.visitCount : 0,
    lastVisit: c.lastVisitAt,
  }));

  res.json({
    success: true,
    data: {
      overview: {
        totalCustomers,
        avgLifetimeValue: Math.round(avgLifetimeValue * 100) / 100,
        avgOrderValue: Math.round((avgOrderValue._avg?.total || 0) * 100) / 100,
        avgVisitCount: Math.round(avgVisitCount * 10) / 10,
      },
      segments: {
        byRecency: {
          active: { count: activeCustomers, label: 'Active (30 days)' },
          atRisk: { count: atRiskCustomers, label: 'At Risk (31-60 days)' },
          lost: { count: lostCustomers, label: 'Lost (60+ days)' },
        },
        byValue: {
          vip: {
            count: vipCustomers.length,
            label: 'VIP (Top 10%)',
            threshold: vipThreshold,
            totalSpent: vipCustomers.reduce((sum, c) => sum + c.totalSpent, 0),
          },
          regular: {
            count: regularCustomers.length,
            label: 'Regular (Top 40%)',
            threshold: regularThreshold,
            totalSpent: regularCustomers.reduce((sum, c) => sum + c.totalSpent, 0),
          },
          occasional: {
            count: occasionalCustomers.length,
            label: 'Occasional',
            totalSpent: occasionalCustomers.reduce((sum, c) => sum + c.totalSpent, 0),
          },
        },
      },
      acquisition: {
        newCustomers: newCustomersCount,
        newCustomerSales,
        returningCustomerSales,
        retentionRate: totalCustomers > 0
          ? Math.round(((totalCustomers - newCustomersCount) / totalCustomers) * 100 * 10) / 10
          : 0,
      },
      topCustomers,
      cohorts: [],
    },
  });
});

/**
 * Get inventory predictions and reorder suggestions
 * GET /api/analytics/inventory-predictions
 */
export const getInventoryPredictions = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Get all active products with inventory tracking
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      trackInventory: true,
    },
    include: {
      category: { select: { name: true } },
      suppliers: {
        include: {
          supplier: { select: { name: true } },
        },
      },
    },
  });

  // Get sales velocity for each product
  const salesData = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: {
      sale: {
        createdAt: { gte: thirtyDaysAgo },
        status: 'COMPLETED',
      },
    },
    _sum: { quantity: true },
    _count: { id: true },
  });

  const salesMap = new Map(salesData.map(s => [s.productId, s]));

  // Analyze each product
  const predictions = products.map(product => {
    const sales = salesMap.get(product.id);
    const quantitySold = sales?._sum.quantity || 0;
    const dailyVelocity = quantitySold / 30;
    const daysOfStock = dailyVelocity > 0 ? product.stockQuantity / dailyVelocity : 999;

    // Get supplier info
    const supplierLink = product.suppliers[0];
    const leadTime = supplierLink?.leadTime || 7;

    // Calculate reorder point
    const safetyStock = Math.ceil(dailyVelocity * 7); // 7 days safety
    const reorderPoint = Math.ceil(dailyVelocity * leadTime) + safetyStock;
    const suggestedOrderQty = Math.ceil(dailyVelocity * 30); // 30 days supply

    // Determine status
    let status: 'critical' | 'low' | 'reorder' | 'adequate' | 'overstock';
    let action: string;

    if (product.stockQuantity === 0) {
      status = 'critical';
      action = `Order ${suggestedOrderQty} units immediately - Out of stock!`;
    } else if (daysOfStock <= leadTime) {
      status = 'critical';
      action = `Order ${suggestedOrderQty} units now - Stock will run out before delivery`;
    } else if (product.stockQuantity <= reorderPoint) {
      status = 'reorder';
      action = `Order ${suggestedOrderQty} units - ${Math.ceil(daysOfStock)} days of stock remaining`;
    } else if (product.stockQuantity <= product.lowStockAlert) {
      status = 'low';
      action = `Consider ordering - Below low stock alert`;
    } else if (daysOfStock > 90 && dailyVelocity > 0) {
      status = 'overstock';
      action = `${Math.ceil(daysOfStock)} days of stock - Consider promotion or markdown`;
    } else {
      status = 'adequate';
      action = `${Math.ceil(daysOfStock)} days of stock remaining`;
    }

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      category: product.category?.name || 'Uncategorized',
      currentStock: product.stockQuantity,
      dailyVelocity: Math.round(dailyVelocity * 100) / 100,
      daysOfStock: Math.min(Math.ceil(daysOfStock), 999),
      reorderPoint,
      suggestedOrderQty,
      status,
      action,
      supplier: supplierLink?.supplier.name || 'No supplier',
      leadTime,
      cost: product.cost,
      totalValue: product.stockQuantity * product.cost,
    };
  });

  // Sort by urgency
  const priorityOrder = { critical: 0, reorder: 1, low: 2, overstock: 3, adequate: 4 };
  predictions.sort((a, b) => priorityOrder[a.status] - priorityOrder[b.status]);

  // Summary
  const critical = predictions.filter(p => p.status === 'critical');
  const reorder = predictions.filter(p => p.status === 'reorder');
  const overstock = predictions.filter(p => p.status === 'overstock');

  // Dead stock analysis (products not sold in 60+ days)
  const recentSales = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: {
      sale: {
        createdAt: { gte: sixtyDaysAgo },
        status: 'COMPLETED',
      },
    },
  });
  const recentlySoldIds = new Set(recentSales.map(s => s.productId));
  const deadStock = products.filter(p =>
    !recentlySoldIds.has(p.id) && p.stockQuantity > 0
  );

  res.json({
    success: true,
    data: {
      predictions,
      summary: {
        totalProducts: predictions.length,
        critical: critical.length,
        needsReorder: reorder.length,
        overstock: overstock.length,
        deadStock: deadStock.length,
        totalInventoryValue: predictions.reduce((sum, p) => sum + p.totalValue, 0),
        potentialStockouts: critical.length + reorder.length,
      },
      deadStock: deadStock.slice(0, 20).map(p => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        stock: p.stockQuantity,
        value: p.stockQuantity * p.cost,
        daysSinceLastSale: 60,
      })),
      autoOrderSuggestions: [...critical, ...reorder].slice(0, 10).map(p => ({
        productId: p.id,
        productName: p.name,
        quantity: p.suggestedOrderQty,
        supplier: p.supplier,
        estimatedCost: p.suggestedOrderQty * p.cost,
        urgency: p.status,
      })),
    },
  });
});

/**
 * Get sales anomaly detection
 * GET /api/analytics/anomalies
 */
export const getSalesAnomalies = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get daily sales for the past 30 days
  const sales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: thirtyDaysAgo },
      status: 'COMPLETED',
    },
    select: {
      id: true,
      total: true,
      createdAt: true,
      items: {
        select: {
          productId: true,
          quantity: true,
          total: true,
        },
      },
    },
  });

  // Daily revenue analysis
  const dailyRevenue = new Map<string, number>();
  sales.forEach(sale => {
    const date = sale.createdAt.toISOString().split('T')[0];
    dailyRevenue.set(date, (dailyRevenue.get(date) || 0) + sale.total);
  });

  const revenues = Array.from(dailyRevenue.values());
  const mean = revenues.length > 0 ? revenues.reduce((a, b) => a + b, 0) / revenues.length : 0;
  const stdDev = revenues.length > 1
    ? Math.sqrt(revenues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / revenues.length)
    : 0;

  // Detect daily anomalies (outside 2 standard deviations)
  const dailyAnomalies: any[] = [];
  dailyRevenue.forEach((revenue, date) => {
    const zScore = stdDev > 0 ? (revenue - mean) / stdDev : 0;
    if (Math.abs(zScore) > 2) {
      dailyAnomalies.push({
        date,
        revenue,
        expected: mean,
        deviation: revenue - mean,
        zScore: Math.round(zScore * 100) / 100,
        type: zScore > 0 ? 'spike' : 'drop',
        severity: Math.abs(zScore) > 3 ? 'high' : 'medium',
      });
    }
  });

  // Product-level anomalies
  const productSales = new Map<string, number[]>();
  sales.forEach(sale => {
    sale.items.forEach(item => {
      if (!productSales.has(item.productId)) {
        productSales.set(item.productId, []);
      }
      productSales.get(item.productId)!.push(item.quantity);
    });
  });

  // Get product names
  const productIds = Array.from(productSales.keys());
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });
  const productMap = new Map(products.map(p => [p.id, p.name]));

  // Find products with unusual sales
  const productAnomalies: any[] = [];
  productSales.forEach((quantities, productId) => {
    if (quantities.length < 5) return;

    const prodMean = quantities.reduce((a, b) => a + b, 0) / quantities.length;
    const prodStdDev = Math.sqrt(
      quantities.reduce((sum, val) => sum + Math.pow(val - prodMean, 2), 0) / quantities.length
    );

    const lastQty = quantities[quantities.length - 1];
    const zScore = prodStdDev > 0 ? (lastQty - prodMean) / prodStdDev : 0;

    if (Math.abs(zScore) > 2) {
      productAnomalies.push({
        productId,
        productName: productMap.get(productId) || 'Unknown',
        lastQuantity: lastQty,
        avgQuantity: Math.round(prodMean * 10) / 10,
        zScore: Math.round(zScore * 100) / 100,
        type: zScore > 0 ? 'surge' : 'decline',
      });
    }
  });

  // Transaction-level anomalies (unusually large transactions)
  const transactionTotals = sales.map(s => s.total);
  const txMean = transactionTotals.length > 0
    ? transactionTotals.reduce((a, b) => a + b, 0) / transactionTotals.length
    : 0;
  const txStdDev = transactionTotals.length > 1
    ? Math.sqrt(transactionTotals.reduce((sum, val) => sum + Math.pow(val - txMean, 2), 0) / transactionTotals.length)
    : 0;

  const transactionAnomalies = sales
    .filter(s => {
      const zScore = txStdDev > 0 ? (s.total - txMean) / txStdDev : 0;
      return Math.abs(zScore) > 2.5;
    })
    .map(s => ({
      saleId: s.id,
      total: s.total,
      date: s.createdAt,
      deviation: s.total - txMean,
      type: s.total > txMean ? 'high_value' : 'low_value',
    }))
    .slice(0, 10);

  res.json({
    success: true,
    data: {
      summary: {
        dailyAnomalies: dailyAnomalies.length,
        productAnomalies: productAnomalies.length,
        transactionAnomalies: transactionAnomalies.length,
        avgDailyRevenue: Math.round(mean * 100) / 100,
        revenueStdDev: Math.round(stdDev * 100) / 100,
      },
      dailyAnomalies: dailyAnomalies.sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
      productAnomalies: productAnomalies.sort((a, b) =>
        Math.abs(b.zScore) - Math.abs(a.zScore)
      ),
      transactionAnomalies,
      insights: [
        dailyAnomalies.filter(a => a.type === 'spike').length > 0
          ? `${dailyAnomalies.filter(a => a.type === 'spike').length} days with unusually high sales detected`
          : null,
        dailyAnomalies.filter(a => a.type === 'drop').length > 0
          ? `${dailyAnomalies.filter(a => a.type === 'drop').length} days with unusually low sales detected`
          : null,
        productAnomalies.filter(a => a.type === 'surge').length > 0
          ? `${productAnomalies.filter(a => a.type === 'surge').length} products with demand surge`
          : null,
      ].filter(Boolean),
    },
  });
});

/**
 * Get bundle recommendations
 * GET /api/analytics/bundle-recommendations
 */
export const getBundleRecommendations = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Get all sales with their items
  const sales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: thirtyDaysAgo },
      status: 'COMPLETED',
    },
    select: {
      id: true,
      items: {
        select: {
          productId: true,
        },
      },
    },
  });

  // Build co-occurrence matrix
  const coOccurrence = new Map<string, Map<string, number>>();
  const productFrequency = new Map<string, number>();

  sales.forEach(sale => {
    const productIds = sale.items.map(item => item.productId);

    // Count individual product frequency
    productIds.forEach(id => {
      productFrequency.set(id, (productFrequency.get(id) || 0) + 1);
    });

    // Count co-occurrences
    for (let i = 0; i < productIds.length; i++) {
      for (let j = i + 1; j < productIds.length; j++) {
        const [a, b] = [productIds[i], productIds[j]].sort();

        if (!coOccurrence.has(a)) coOccurrence.set(a, new Map());
        if (!coOccurrence.has(b)) coOccurrence.set(b, new Map());

        coOccurrence.get(a)!.set(b, (coOccurrence.get(a)!.get(b) || 0) + 1);
        coOccurrence.get(b)!.set(a, (coOccurrence.get(b)!.get(a) || 0) + 1);
      }
    }
  });

  // Get product details
  const productIds = Array.from(productFrequency.keys());
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, price: true, cost: true },
  });
  const productMap = new Map(products.map(p => [p.id, p]));

  // Find best bundles
  const bundles: any[] = [];

  coOccurrence.forEach((partners, productId) => {
    partners.forEach((count, partnerId) => {
      if (count >= 3) { // Minimum 3 co-occurrences
        const product1 = productMap.get(productId);
        const product2 = productMap.get(partnerId);
        if (!product1 || !product2) return;

        const freq1 = productFrequency.get(productId) || 1;
        const freq2 = productFrequency.get(partnerId) || 1;

        // Calculate lift (how much more likely to buy together vs independently)
        const expectedCoOccurrence = (freq1 * freq2) / sales.length;
        const lift = expectedCoOccurrence > 0 ? count / expectedCoOccurrence : 0;

        // Calculate confidence (given A, probability of B)
        const confidence = count / freq1;

        if (lift > 1.5 && confidence > 0.1) {
          const bundleKey = [productId, partnerId].sort().join('|');
          if (!bundles.find(b => b.key === bundleKey)) {
            const combinedPrice = product1.price + product2.price;
            const combinedCost = product1.cost + product2.cost;
            const suggestedDiscount = 10; // 10% bundle discount
            const bundlePrice = combinedPrice * (1 - suggestedDiscount / 100);

            bundles.push({
              key: bundleKey,
              products: [
                { id: productId, name: product1.name, price: product1.price },
                { id: partnerId, name: product2.name, price: product2.price },
              ],
              coOccurrences: count,
              lift: Math.round(lift * 100) / 100,
              confidence: Math.round(confidence * 100) / 100,
              combinedPrice,
              suggestedBundlePrice: Math.round(bundlePrice * 100) / 100,
              potentialMargin: Math.round((bundlePrice - combinedCost) * 100) / 100,
              suggestedDiscount,
            });
          }
        }
      }
    });
  });

  // Sort by lift
  bundles.sort((a, b) => b.lift - a.lift);

  res.json({
    success: true,
    data: {
      recommendations: bundles.slice(0, 20),
      summary: {
        totalBundlesFound: bundles.length,
        avgLift: bundles.length > 0
          ? Math.round((bundles.reduce((sum, b) => sum + b.lift, 0) / bundles.length) * 100) / 100
          : 0,
        potentialRevenue: bundles.slice(0, 10).reduce((sum, b) =>
          sum + (b.coOccurrences * b.suggestedBundlePrice), 0
        ),
      },
      insights: [
        bundles.length > 0 ? `Found ${bundles.length} product pairs frequently bought together` : null,
        bundles.filter(b => b.lift > 3).length > 0
          ? `${bundles.filter(b => b.lift > 3).length} bundles have very strong association (lift > 3)`
          : null,
      ].filter(Boolean),
    },
  });
});

/**
 * Get employee performance scores and leaderboard
 * GET /api/analytics/employee-performance
 */
export const getEmployeePerformance = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { days = '30' } = req.query;
  const daysNum = parseInt(days as string);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysNum);

  // Get all employees
  const employees = await prisma.user.findMany({
    where: { role: { in: ['CASHIER', 'MANAGER', 'ADMIN'] } },
    select: { id: true, firstName: true, lastName: true, role: true },
  });

  // Get sales data per employee
  const employeeMetrics = await Promise.all(
    employees.map(async (employee) => {
      const [sales, refunds, shifts] = await Promise.all([
        // Sales metrics
        prisma.sale.aggregate({
          where: {
            userId: employee.id,
            createdAt: { gte: startDate },
            status: 'COMPLETED',
          },
          _sum: { total: true },
          _count: { id: true },
          _avg: { total: true },
        }),
        // Refunds (negative indicator)
        prisma.sale.count({
          where: {
            userId: employee.id,
            createdAt: { gte: startDate },
            status: 'REFUNDED',
          },
        }),
        // Shift hours
        prisma.shift.findMany({
          where: {
            userId: employee.id,
            clockInAt: { gte: startDate },
            clockOutAt: { not: null },
          },
          select: { clockInAt: true, clockOutAt: true },
        }),
      ]);

      // Calculate hours worked
      const hoursWorked = shifts.reduce((total, shift) => {
        if (shift.clockOutAt) {
          return total + (shift.clockOutAt.getTime() - shift.clockInAt.getTime()) / (1000 * 60 * 60);
        }
        return total;
      }, 0);

      const totalSales = sales._count.id || 0;
      const totalRevenue = sales._sum.total || 0;
      const avgTransaction = sales._avg.total || 0;
      const revenuePerHour = hoursWorked > 0 ? totalRevenue / hoursWorked : 0;
      const transactionsPerHour = hoursWorked > 0 ? totalSales / hoursWorked : 0;
      const refundRate = totalSales > 0 ? (refunds / totalSales) * 100 : 0;

      return {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        role: employee.role,
        metrics: {
          totalSales,
          totalRevenue,
          avgTransaction,
          hoursWorked: Math.round(hoursWorked * 10) / 10,
          revenuePerHour: Math.round(revenuePerHour * 100) / 100,
          transactionsPerHour: Math.round(transactionsPerHour * 10) / 10,
          refunds,
          refundRate: Math.round(refundRate * 10) / 10,
        },
      };
    })
  );

  // Calculate performance scores (0-100)
  const maxRevenue = Math.max(...employeeMetrics.map(e => e.metrics.totalRevenue), 1);
  const maxTransactions = Math.max(...employeeMetrics.map(e => e.metrics.totalSales), 1);
  const maxAvgTransaction = Math.max(...employeeMetrics.map(e => e.metrics.avgTransaction), 1);
  const maxRevenuePerHour = Math.max(...employeeMetrics.map(e => e.metrics.revenuePerHour), 1);

  const scoredEmployees = employeeMetrics.map(emp => {
    // Weighted scoring
    const revenueScore = (emp.metrics.totalRevenue / maxRevenue) * 30;
    const transactionScore = (emp.metrics.totalSales / maxTransactions) * 25;
    const avgTransactionScore = (emp.metrics.avgTransaction / maxAvgTransaction) * 20;
    const efficiencyScore = (emp.metrics.revenuePerHour / maxRevenuePerHour) * 20;
    const qualityScore = Math.max(0, 5 - emp.metrics.refundRate); // Lower refunds = higher score

    const totalScore = revenueScore + transactionScore + avgTransactionScore + efficiencyScore + qualityScore;

    // Determine badges
    const badges: string[] = [];
    if (emp.metrics.totalRevenue === maxRevenue) badges.push('Top Seller');
    if (emp.metrics.avgTransaction === maxAvgTransaction) badges.push('Upsell Champion');
    if (emp.metrics.revenuePerHour === maxRevenuePerHour) badges.push('Most Efficient');
    if (emp.metrics.refundRate === 0 && emp.metrics.totalSales > 10) badges.push('Quality Star');
    if (emp.metrics.totalSales > 100) badges.push('High Volume');

    return {
      ...emp,
      score: Math.round(totalScore),
      badges,
      rank: 0, // Will be set after sorting
    };
  });

  // Sort by score and assign ranks
  scoredEmployees.sort((a, b) => b.score - a.score);
  scoredEmployees.forEach((emp, index) => {
    emp.rank = index + 1;
  });

  // Team statistics
  const teamStats = {
    totalRevenue: employeeMetrics.reduce((sum, e) => sum + e.metrics.totalRevenue, 0),
    totalTransactions: employeeMetrics.reduce((sum, e) => sum + e.metrics.totalSales, 0),
    avgScore: scoredEmployees.length > 0
      ? Math.round(scoredEmployees.reduce((sum, e) => sum + e.score, 0) / scoredEmployees.length)
      : 0,
    topPerformer: scoredEmployees[0]?.name || 'N/A',
  };

  res.json({
    success: true,
    data: {
      leaderboard: scoredEmployees,
      teamStats,
      period: {
        days: daysNum,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      scoringWeights: {
        revenue: '30%',
        transactions: '25%',
        avgTransaction: '20%',
        efficiency: '20%',
        quality: '5%',
      },
    },
  });
});

/**
 * Get business health dashboard
 * GET /api/analytics/business-health
 */
export const getBusinessHealth = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // Get comprehensive financial data
  const [
    todaySales,
    monthSales,
    lastMonthSales,
    yearSales,
    inventory,
    expenses,
    customers,
  ] = await Promise.all([
    // Today
    prisma.sale.aggregate({
      where: { createdAt: { gte: todayStart }, status: 'COMPLETED' },
      _sum: { total: true, tax: true },
      _count: { id: true },
    }),
    // This month
    prisma.sale.aggregate({
      where: { createdAt: { gte: monthStart }, status: 'COMPLETED' },
      _sum: { total: true, tax: true },
      _count: { id: true },
    }),
    // Last month
    prisma.sale.aggregate({
      where: {
        createdAt: { gte: lastMonthStart, lt: monthStart },
        status: 'COMPLETED'
      },
      _sum: { total: true },
      _count: { id: true },
    }),
    // Year to date
    prisma.sale.aggregate({
      where: { createdAt: { gte: yearStart }, status: 'COMPLETED' },
      _sum: { total: true, tax: true },
      _count: { id: true },
    }),
    // Inventory units
    prisma.product.aggregate({
      where: { isActive: true },
      _sum: { stockQuantity: true },
    }),
    // Expenses this month
    prisma.expense.aggregate({
      where: {
        expenseDate: { gte: monthStart },
        status: 'APPROVED',
      },
      _sum: { amount: true },
    }),
    // Customer stats
    prisma.customer.aggregate({
      _count: { id: true },
      _sum: { totalSpent: true },
    }),
  ]);

  // Calculate inventory value (need separate query for cost)
  const productsWithCost = await prisma.product.findMany({
    where: { isActive: true },
    select: { stockQuantity: true, cost: true, price: true },
  });

  const inventoryAtCost = productsWithCost.reduce((sum, p) => sum + (p.stockQuantity * p.cost), 0);
  const inventoryAtRetail = productsWithCost.reduce((sum, p) => sum + (p.stockQuantity * p.price), 0);

  // Calculate estimated COGS (assuming 40% margin on average)
  const estimatedCOGS = (monthSales._sum.total || 0) * 0.6;
  const grossProfit = (monthSales._sum.total || 0) - estimatedCOGS;
  const netProfit = grossProfit - (expenses._sum.amount || 0);

  // KPIs
  const monthlyRevenue = monthSales._sum.total || 0;
  const lastMonthRevenue = lastMonthSales._sum.total || 0;
  const revenueGrowth = lastMonthRevenue > 0
    ? ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
    : 0;

  const avgDailyRevenue = monthlyRevenue / now.getDate();
  const projectedMonthlyRevenue = avgDailyRevenue * new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  // Break-even analysis (simplified)
  const fixedCosts = 5000; // Placeholder - would come from settings
  const avgMargin = 0.4;
  const breakEvenRevenue = fixedCosts / avgMargin;
  const breakEvenProgress = (monthlyRevenue / breakEvenRevenue) * 100;

  // Health scores
  const scores = {
    revenue: Math.min(100, (monthlyRevenue / (lastMonthRevenue || monthlyRevenue)) * 50),
    profitability: Math.min(100, (netProfit / (monthlyRevenue || 1)) * 250),
    inventory: Math.min(100, 100 - Math.abs(50 - ((inventoryAtCost / (monthlyRevenue || 1)) * 100))),
    growth: Math.min(100, 50 + revenueGrowth),
  };
  const overallHealth = Math.round((scores.revenue + scores.profitability + scores.inventory + scores.growth) / 4);

  res.json({
    success: true,
    data: {
      overview: {
        todayRevenue: todaySales._sum.total || 0,
        todayTransactions: todaySales._count.id || 0,
        monthRevenue: monthlyRevenue,
        monthTransactions: monthSales._count.id || 0,
        yearRevenue: yearSales._sum.total || 0,
        yearTransactions: yearSales._count.id || 0,
      },
      profitability: {
        grossRevenue: monthlyRevenue,
        estimatedCOGS,
        grossProfit,
        grossMargin: monthlyRevenue > 0 ? (grossProfit / monthlyRevenue) * 100 : 0,
        expenses: expenses._sum.amount || 0,
        netProfit,
        netMargin: monthlyRevenue > 0 ? (netProfit / monthlyRevenue) * 100 : 0,
      },
      inventory: {
        totalUnits: inventory._sum.stockQuantity || 0,
        valueAtCost: inventoryAtCost,
        valueAtRetail: inventoryAtRetail,
        potentialProfit: inventoryAtRetail - inventoryAtCost,
        turnoverRatio: inventoryAtCost > 0 ? estimatedCOGS / inventoryAtCost : 0,
      },
      kpis: {
        revenueGrowth: Math.round(revenueGrowth * 10) / 10,
        avgTransactionValue: monthSales._count.id
          ? Math.round((monthlyRevenue / monthSales._count.id) * 100) / 100
          : 0,
        projectedMonthlyRevenue: Math.round(projectedMonthlyRevenue),
        customerLifetimeValue: customers._count.id
          ? Math.round((customers._sum.totalSpent || 0) / customers._count.id)
          : 0,
        breakEvenProgress: Math.min(100, Math.round(breakEvenProgress)),
      },
      healthScores: {
        overall: overallHealth,
        revenue: Math.round(scores.revenue),
        profitability: Math.round(scores.profitability),
        inventory: Math.round(scores.inventory),
        growth: Math.round(scores.growth),
      },
      cashFlow: {
        inflows: monthlyRevenue,
        outflows: (expenses._sum.amount || 0) + estimatedCOGS,
        netCashFlow: monthlyRevenue - (expenses._sum.amount || 0) - estimatedCOGS,
      },
    },
  });
});

/**
 * Get what-if scenario analysis
 * POST /api/analytics/what-if
 */
export const getWhatIfAnalysis = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { priceChange, costChange, volumeChange } = req.body;

  const monthStart = new Date();
  monthStart.setDate(1);

  // Get current month data
  const currentSales = await prisma.sale.aggregate({
    where: { createdAt: { gte: monthStart }, status: 'COMPLETED' },
    _sum: { total: true },
    _count: { id: true },
  });

  const currentRevenue = currentSales._sum.total || 0;
  const currentTransactions = currentSales._count.id || 0;
  const avgTransaction = currentTransactions > 0 ? currentRevenue / currentTransactions : 0;

  // Assume 40% margin
  const currentMargin = 0.4;
  const currentCOGS = currentRevenue * (1 - currentMargin);
  const currentProfit = currentRevenue - currentCOGS;

  // Calculate scenarios
  const scenarios = {
    current: {
      revenue: currentRevenue,
      transactions: currentTransactions,
      avgTransaction,
      cogs: currentCOGS,
      profit: currentProfit,
      margin: currentMargin * 100,
    },
    projected: {
      revenue: 0,
      transactions: 0,
      avgTransaction: 0,
      cogs: 0,
      profit: 0,
      margin: 0,
    },
    difference: {
      revenue: 0,
      transactions: 0,
      profit: 0,
      margin: 0,
    },
  };

  // Price change affects revenue and margin
  const priceMultiplier = 1 + (priceChange || 0) / 100;
  // Cost change affects COGS
  const costMultiplier = 1 + (costChange || 0) / 100;
  // Volume change affects transactions (price elasticity assumed)
  const volumeMultiplier = 1 + (volumeChange || 0) / 100;
  // Simple price elasticity: 10% price increase = 5% volume decrease
  const elasticityEffect = priceChange ? Math.pow(0.95, priceChange / 10) : 1;

  const projectedTransactions = Math.round(currentTransactions * volumeMultiplier * elasticityEffect);
  const projectedAvgTransaction = avgTransaction * priceMultiplier;
  const projectedRevenue = projectedTransactions * projectedAvgTransaction;
  const projectedCOGS = (currentCOGS / currentTransactions) * projectedTransactions * costMultiplier;
  const projectedProfit = projectedRevenue - projectedCOGS;
  const projectedMargin = projectedRevenue > 0 ? (projectedProfit / projectedRevenue) * 100 : 0;

  scenarios.projected = {
    revenue: Math.round(projectedRevenue * 100) / 100,
    transactions: projectedTransactions,
    avgTransaction: Math.round(projectedAvgTransaction * 100) / 100,
    cogs: Math.round(projectedCOGS * 100) / 100,
    profit: Math.round(projectedProfit * 100) / 100,
    margin: Math.round(projectedMargin * 10) / 10,
  };

  scenarios.difference = {
    revenue: Math.round((projectedRevenue - currentRevenue) * 100) / 100,
    transactions: projectedTransactions - currentTransactions,
    profit: Math.round((projectedProfit - currentProfit) * 100) / 100,
    margin: Math.round((projectedMargin - currentMargin * 100) * 10) / 10,
  };

  res.json({
    success: true,
    data: {
      scenarios,
      inputs: {
        priceChange: priceChange || 0,
        costChange: costChange || 0,
        volumeChange: volumeChange || 0,
      },
      insights: [
        scenarios.difference.profit > 0
          ? `This scenario would increase profit by $${scenarios.difference.profit}`
          : `This scenario would decrease profit by $${Math.abs(scenarios.difference.profit)}`,
        priceChange && priceChange > 0
          ? `Price increase may reduce volume by ~${Math.round((1 - elasticityEffect) * 100)}% due to elasticity`
          : null,
        scenarios.difference.margin > 2
          ? 'Significant margin improvement expected'
          : scenarios.difference.margin < -2
          ? 'Warning: Margin compression expected'
          : null,
      ].filter(Boolean),
    },
  });
});

/**
 * Get real-time metrics
 * GET /api/analytics/realtime
 */
export const getRealtimeMetrics = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [
    todaySales,
    lastHourSales,
    pendingSales,
    activeShifts,
    recentTransactions
  ] = await Promise.all([
    // Today's totals
    prisma.sale.aggregate({
      where: {
        createdAt: { gte: todayStart },
        status: 'COMPLETED',
      },
      _sum: { total: true },
      _count: { id: true },
    }),
    // Last hour
    prisma.sale.aggregate({
      where: {
        createdAt: { gte: oneHourAgo },
        status: 'COMPLETED',
      },
      _sum: { total: true },
      _count: { id: true },
    }),
    // Pending sales
    prisma.sale.count({
      where: { status: 'PENDING' },
    }),
    // Active shifts
    prisma.shift.count({
      where: { clockOutAt: null },
    }),
    // Recent transactions
    prisma.sale.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      where: { status: 'COMPLETED' },
      select: {
        id: true,
        saleNumber: true,
        total: true,
        createdAt: true,
        customer: { select: { firstName: true, lastName: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  // Low stock alerts - in memory check
  const productsForLowStock = await prisma.product.findMany({
    where: {
      isActive: true,
      trackInventory: true,
    },
    select: {
      stockQuantity: true,
      lowStockAlert: true,
    },
  });
  const lowStockCount = productsForLowStock.filter(p => p.stockQuantity <= p.lowStockAlert).length;

  const todayCount = todaySales._count?.id || 0;
  const todayTotal = todaySales._sum?.total || 0;

  res.json({
    success: true,
    data: {
      today: {
        revenue: todayTotal,
        profit: 0,
        transactions: todayCount,
        avgOrderValue: todayCount > 0 ? todayTotal / todayCount : 0,
      },
      lastHour: {
        revenue: lastHourSales._sum?.total || 0,
        transactions: lastHourSales._count?.id || 0,
      },
      alerts: {
        pendingSales,
        lowStockItems: lowStockCount,
        activeShifts,
      },
      recentTransactions: recentTransactions.map(t => ({
        id: t.id,
        saleNumber: t.saleNumber,
        total: t.total,
        time: t.createdAt,
        customer: t.customer ? `${t.customer.firstName} ${t.customer.lastName}`.trim() : 'Walk-in',
        employee: t.user ? `${t.user.firstName} ${t.user.lastName}`.trim() : 'Unknown',
      })),
      timestamp: now.toISOString(),
    },
  });
});
