import { employeeActivity } from '../services/employeeActivity.service';
import { inventoryPredictions, salesAnomalies, abcAnalysis } from '../services/inventoryAnalytics.service';
import { getSalesForecastData } from '../services/salesForecast.service';
import { Response } from 'express';
import { getFinancialMetrics, getProductFinancialMetrics } from '../services/financialMetrics.service';
import { getReportCalendar } from '../services/reportDates.service';
import { z } from 'zod';
import { asyncHandler } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { getLocationFilter } from '../utils/locationFilter.util';

/** Round a number to 2 decimal places (currency precision) */
const rc = (n: number) => Math.round(n * 100) / 100;

/**
 * Get comparison analytics (YoY, MoM, WoW)
 * GET /api/analytics/comparison
 */
export const getComparisonAnalytics = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationFilter = getLocationFilter(req, req.query.locationId as string);
  const calendar = await getReportCalendar(locationFilter);
  const now = calendar.now;
  const todayStart = calendar.day();
  const weekStart = calendar.day(-calendar.weekday);
  const monthStart = calendar.monthStart();
  const yearStart = calendar.yearStart();
  const prevDayStart = calendar.day(-1);
  const prevWeekStart = calendar.day(-calendar.weekday - 7);
  const prevMonthStart = calendar.monthStart(-1);
  const prevYearStart = calendar.yearStart(-1);
  const prevYearEnd = yearStart;
  const lastYearSameDayStart = calendar.midnight(calendar.year - 1, calendar.month, calendar.dayOfMonth);
  const lastYearSameWeekStart = calendar.midnight(calendar.year - 1, calendar.month, calendar.dayOfMonth - calendar.weekday);
  const lastYearSameMonthStart = calendar.midnight(calendar.year - 1, calendar.month, 1);

  const getSalesForPeriod = async (start: Date, end: Date) => {
    const metrics = await getFinancialMetrics(locationFilter, { gte: start, lt: end });
    return { revenue: metrics.netCollected, netSales: metrics.netSales, profit: metrics.grossProfit,
      transactions: metrics.transactions, costBasis: metrics.costBasis, unavailableReason: metrics.unavailableReason };
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
    getSalesForPeriod(lastYearSameDayStart, calendar.midnight(calendar.year - 1, calendar.month, calendar.dayOfMonth + 1)),
    getSalesForPeriod(weekStart, now),
    getSalesForPeriod(prevWeekStart, weekStart),
    getSalesForPeriod(lastYearSameWeekStart, calendar.midnight(calendar.year - 1, calendar.month, calendar.dayOfMonth - calendar.weekday + 7)),
    getSalesForPeriod(monthStart, now),
    getSalesForPeriod(prevMonthStart, monthStart),
    getSalesForPeriod(lastYearSameMonthStart, calendar.midnight(calendar.year - 1, calendar.month + 1, 1)),
    getSalesForPeriod(yearStart, now),
    getSalesForPeriod(prevYearStart, prevYearEnd),
  ]);

  // Calculate growth percentages
  // With nothing in the earlier period there is no honest percentage (it used to read +100%).
  const calcGrowth = (current: number, previous: number): number | null => {
    if (previous === 0) return current > 0 ? null : 0;
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
export const getABCAnalysis = asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await abcAnalysis(getLocationFilter(req, req.query.locationId as string), req.query.days || 90, new Date(), req.query.page || 1) }));

/**
 * Get product performance matrix
 * GET /api/analytics/product-matrix
 */
export const getProductPerformanceMatrix = asyncHandler(async (req: AuthRequest, res: Response) => {
  const daysNum = z.coerce.number().int().min(1).max(366).parse(req.query.days ?? 30);
  const locationFilter = getLocationFilter(req, req.query.locationId as string);
  const calendar = await getReportCalendar(locationFilter);
  const startDate = calendar.day(1 - daysNum);
  const metrics = await getProductFinancialMetrics(locationFilter, { gte: startDate, lte: calendar.now });
  const products = await prisma.product.findMany({ where: { id: { in: metrics.map(row => row.productId) }, ...locationFilter }, include: { category: { select: { name: true } } } });
  const byId = new Map(products.map(product => [product.id, product]));
  const productMetrics = metrics.map(row => {
    const product = byId.get(row.productId);
    return { ...row, id: row.productId, name: row.productName, quantity: row.quantitySold,
      category: product?.category?.name || 'Uncategorized', velocity: rc(row.quantitySold / daysNum),
      cost: Number(product?.cost || 0), price: Number(product?.price || 0), stock: product?.stockQuantity || 0 };
  });

  // Calculate quartiles for velocity and margin
  const velocities = productMetrics.map(p => p.velocity).sort((a, b) => a - b);
  const margins = productMetrics.map(p => p.margin).filter((m): m is number => m !== null).sort((a, b) => a - b);

  const medianVelocity = velocities[Math.floor(velocities.length / 2)] || 0;
  const medianMargin = margins[Math.floor(margins.length / 2)] || 0;

  // Classify products into quadrants
  const matrixProducts = productMetrics.map(product => {
    if (product.margin === null) return { ...product, quadrant: 'unavailable' as const };
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
      unavailableCount: matrixProducts.filter(p => p.quadrant === 'unavailable').length,
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
        endDate: calendar.now.toISOString(),
        timezone: calendar.timezone,
      },
    },
  });
});

/**
 * Get sales forecast
 * GET /api/analytics/forecast
 */
export const getSalesForecast = asyncHandler(async (req: AuthRequest, res: Response) => {
  const scope = getLocationFilter(req, req.query.locationId as string);
  res.json({ success: true, data: await getSalesForecastData(scope, req.query.forecastDays ?? 30) });
});

/**
 * Get customer insights
 * GET /api/analytics/customer-insights
 */
export const getCustomerInsights = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationFilter = getLocationFilter(req, req.query.locationId as string);
  const calendar = await getReportCalendar(locationFilter);
  const now = calendar.now;
  const thirtyDaysAgo = calendar.day(-30);
  const sixtyDaysAgo = calendar.day(-60);

  // Deleted (inactive) customers are left out of every segment.
  const activeFilter = { ...locationFilter, isActive: true };
  const [activeCustomers, atRiskCustomers, lostCustomers, noVisitCustomers] = await Promise.all([
    prisma.customer.count({
      where: { lastVisitAt: { gte: thirtyDaysAgo, lte: now }, ...activeFilter },
    }),
    prisma.customer.count({
      where: {
        lastVisitAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        ...activeFilter,
      },
    }),
    prisma.customer.count({
      where: { lastVisitAt: { lt: sixtyDaysAgo }, ...activeFilter },
    }),
    // Customers who have never bought are not "lost": they never visited.
    prisma.customer.count({
      where: { lastVisitAt: null, ...activeFilter },
    }),
  ]);

  // Get customer value segments
  const customers = await prisma.customer.findMany({
    where: activeFilter,
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

  // Value tiers rank customers who have spent something: the top 10% are VIP,
  // the next 30% Regular, the rest Occasional. Customers with no spend sit apart,
  // so a store where most customers have $0 does not call everyone VIP.
  const sortedBySpend = [...customers].sort((a, b) => Number(b.totalSpent) - Number(a.totalSpent));
  const totalCustomers = customers.length;
  const spenders = sortedBySpend.filter(c => Number(c.totalSpent) > 0);
  const vipCount = spenders.length ? Math.max(1, Math.ceil(spenders.length * 0.1)) : 0;
  const regularCount = Math.max(0, Math.min(spenders.length - vipCount, Math.ceil(spenders.length * 0.4) - vipCount));
  const vipCustomers = spenders.slice(0, vipCount);
  const regularCustomers = spenders.slice(vipCount, vipCount + regularCount);
  const occasionalCustomers = spenders.slice(vipCount + regularCount);
  const noPurchaseCount = totalCustomers - spenders.length;
  const vipThreshold = vipCustomers.length ? vipCustomers[vipCustomers.length - 1].totalSpent : null;
  const regularThreshold = regularCustomers.length ? regularCustomers[regularCustomers.length - 1].totalSpent : null;

  // New vs returning analysis (last 30 days)
  const newCustomersCount = await prisma.customer.count({
    where: { createdAt: { gte: thirtyDaysAgo, lte: now }, ...activeFilter },
  });

  const returningCustomerSales = await prisma.sale.count({
    where: {
      createdAt: { gte: thirtyDaysAgo, lte: now },
      status: 'COMPLETED',
      customer: {
        createdAt: { lt: thirtyDaysAgo },
        isActive: true,
      },
      ...locationFilter,
    },
  });

  const newCustomerSales = await prisma.sale.count({
    where: {
      createdAt: { gte: thirtyDaysAgo, lte: now },
      status: 'COMPLETED',
      customer: {
        createdAt: { gte: thirtyDaysAgo, lte: now },
      },
      ...locationFilter,
    },
  });

  // Customer lifetime value distribution
  const avgLifetimeValue = totalCustomers > 0
    ? customers.reduce((sum, c) => sum + Number(c.totalSpent), 0) / totalCustomers
    : 0;
  const avgOrderValue = await prisma.sale.aggregate({
    where: {
      status: 'COMPLETED',
      customerId: { not: null },
      ...locationFilter,
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
    avgOrderValue: c.visitCount > 0 ? rc(Number(c.totalSpent) / c.visitCount) : 0,
    lastVisit: c.lastVisitAt,
  }));

  res.json({
    success: true,
    data: {
      overview: {
        totalCustomers,
        avgLifetimeValue: Math.round(avgLifetimeValue * 100) / 100,
        avgOrderValue: Math.round(Number((avgOrderValue._avg?.total || 0)) * 100) / 100,
        avgVisitCount: Math.round(avgVisitCount * 10) / 10,
      },
      segments: {
        byRecency: {
          active: { count: activeCustomers, label: 'Active (30 days)' },
          atRisk: { count: atRiskCustomers, label: 'At Risk (31-60 days)' },
          lost: { count: lostCustomers, label: 'Lost (60+ days)' },
          noVisits: { count: noVisitCustomers, label: 'No visits yet' },
        },
        byValue: {
          vip: {
            count: vipCustomers.length,
            label: 'VIP (Top 10%)',
            threshold: vipThreshold,
            totalSpent: rc(vipCustomers.reduce((sum, c) => sum + Number(c.totalSpent), 0)),
          },
          regular: {
            count: regularCustomers.length,
            label: 'Regular (next 30%)',
            threshold: regularThreshold,
            totalSpent: rc(regularCustomers.reduce((sum, c) => sum + Number(c.totalSpent), 0)),
          },
          occasional: {
            count: occasionalCustomers.length,
            label: 'Occasional',
            totalSpent: rc(occasionalCustomers.reduce((sum, c) => sum + Number(c.totalSpent), 0)),
          },
          noPurchases: { count: noPurchaseCount, label: 'No purchases yet', totalSpent: 0 },
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
export const getInventoryPredictions = asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await inventoryPredictions(getLocationFilter(req, req.query.locationId as string), req.query.page || 1) }));

/**
 * Get sales anomaly detection
 * GET /api/analytics/anomalies
 */
export const getSalesAnomalies = asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await salesAnomalies(getLocationFilter(req, req.query.locationId as string)) }));

/**
 * Get bundle recommendations
 * GET /api/analytics/bundle-recommendations
 */
export const getBundleRecommendations = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationFilter = getLocationFilter(req, req.query.locationId as string);
  const calendar = await getReportCalendar(locationFilter);
  const thirtyDaysAgo = calendar.day(-30);

  // Get all sales with their items
  const sales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: thirtyDaysAgo, lt: calendar.day() },
      status: 'COMPLETED',
      ...locationFilter,
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
    const productIds = [...new Set(sale.items.map(item => item.productId))];

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
    where: { id: { in: productIds }, ...locationFilter },
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
            const combinedPrice = Number(product1.price) + Number(product2.price);
            const combinedCost = Number(product1.cost) + Number(product2.cost);
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
export const getEmployeePerformance = asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await employeeActivity(getLocationFilter(req, req.query.locationId as string), req.query.days || 30) }));

/**
 * Get business health dashboard
 * GET /api/analytics/business-health
 */
export const getBusinessHealth = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationFilter = getLocationFilter(req, req.query.locationId as string);
  const calendar = await getReportCalendar(locationFilter);
  const now = calendar.now;
  const todayStart = calendar.day();
  const monthStart = calendar.monthStart();
  const lastMonthStart = calendar.monthStart(-1);
  const yearStart = calendar.yearStart();
  const [today, month, lastMonth, year, products, customers] = await Promise.all([
    getFinancialMetrics(locationFilter, { gte: todayStart, lte: now }),
    getFinancialMetrics(locationFilter, { gte: monthStart, lte: now }),
    getFinancialMetrics(locationFilter, { gte: lastMonthStart, lt: monthStart }),
    getFinancialMetrics(locationFilter, { gte: yearStart, lte: now }),
    prisma.product.findMany({ where: { isActive: true, trackInventory: true, sku: { not: 'MISC-001' }, ...locationFilter }, select: { id: true, stockQuantity: true, price: true } }),
    prisma.customer.aggregate({ where: locationFilter, _count: { id: true }, _sum: { totalSpent: true } }),
  ]);
  const valuations = await prisma.inventoryValuation.findMany({ where: { productId: { in: products.map(p => p.id) } } });
  const incompleteInventory = products.some(p => p.stockQuantity > 0 && valuations.find(v => v.productId === p.id)?.value == null);
  const inventoryAtCost = incompleteInventory ? null : rc(valuations.reduce((sum, v) => sum + Number(v.value || 0), 0));
  const inventoryAtRetail = rc(products.reduce((sum, p) => sum + Math.max(0, p.stockQuantity) * Number(p.price), 0));
  const revenueGrowth = lastMonth.netCollected > 0 ? rc((month.netCollected - lastMonth.netCollected) / lastMonth.netCollected * 100) : null;
  const score = (n: number) => Math.round(Math.max(0, Math.min(100, n)));
  const healthScores = {
    overall: null as number | null,
    revenue: month.netCollected > 0 && lastMonth.netCollected > 0 ? score(month.netCollected / lastMonth.netCollected * 50) : null,
    profitability: month.operatingMargin === null ? null : score(month.operatingMargin * 2.5),
    inventory: month.netCollected > 0 && inventoryAtCost !== null ? score(100 - Math.abs(50 - inventoryAtCost / month.netCollected * 100)) : null,
    growth: revenueGrowth === null ? null : score(50 + revenueGrowth),
  };
  const scores = [healthScores.revenue, healthScores.profitability, healthScores.inventory, healthScores.growth];
  if (scores.every((n): n is number => n !== null)) healthScores.overall = score(scores.reduce((n, s) => n + s, 0) / scores.length);
  res.json({ success: true, data: {
    overview: { todayRevenue: today.netCollected, todayTransactions: today.transactions,
      monthRevenue: month.netCollected, monthTransactions: month.transactions, yearRevenue: year.netCollected, yearTransactions: year.transactions },
    profitability: { grossRevenue: month.netSales, estimatedCOGS: month.costOfGoodsSold, costOfGoodsSold: month.costOfGoodsSold,
      grossProfit: month.grossProfit, grossMargin: month.grossMargin, expenses: month.expenses, otherIncome: month.otherIncome,
      inventoryPurchases: month.inventoryPurchases, receivedInventoryPurchases: month.receivedInventoryPurchases,
      netProfit: month.netProfit, netMargin: month.netProfit === null || !month.netSales ? null : rc(month.netProfit / month.netSales * 100), costBasis: month.costBasis, unavailableReason: month.unavailableReason,
      recordedSaleCosts: month.recordedSaleCosts, inventoryCostAdjustments: month.inventoryCostAdjustments, costCompleteness: month.costCompleteness },
    inventory: { totalUnits: products.reduce((sum, p) => sum + Math.max(0, p.stockQuantity), 0), valueAtCost: inventoryAtCost,
      valueAtRetail: inventoryAtRetail, potentialProfit: inventoryAtCost === null ? null : rc(inventoryAtRetail - inventoryAtCost),
      turnoverRatio: null, turnoverReason: 'Historical average inventory is required to calculate turnover.' },
    kpis: { revenueGrowth, avgTransactionValue: month.transactions === null ? null : month.transactions ? rc(month.netCollected / month.transactions) : 0,
      projectedMonthlyRevenue: rc(month.netCollected / calendar.dayOfMonth * new Date(Date.UTC(calendar.year, calendar.month, 0)).getUTCDate()),
      customerLifetimeValue: customers._count.id ? rc(Number((customers._sum.totalSpent || 0)) / customers._count.id) : 0,
      breakEvenProgress: null, breakEvenReason: 'Break-even requires a configured fixed/variable expense model.' },
    healthScores, healthScoreBasis: 'Heuristic indicators; unavailable when required history is missing.',
    projectionBasis: "Estimate using this month's average daily collected sales; not a guarantee.",
    cashFlow: { inflows: null, outflows: null, netCashFlow: null,
      unavailableReason: 'Profit is not cash flow. Complete payment and expense settlement records are required.' },
  } });
});

/**
 * Get what-if scenario analysis
 * POST /api/analytics/what-if
 */
export const getWhatIfAnalysis = asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = z.object({ priceChange: z.number().finite().min(-100).max(1000).default(0),
    costChange: z.number().finite().min(-100).max(1000).default(0), volumeChange: z.number().finite().min(-100).max(1000).default(0),
    locationId: z.string().optional() }).parse(req.body);
  const locationFilter = getLocationFilter(req, input.locationId);
  const calendar = await getReportCalendar(locationFilter);
  const now = calendar.now;
  const metrics = await getFinancialMetrics(locationFilter, { gte: calendar.monthStart(), lte: now });
  const volume = 1 + input.volumeChange / 100;
  const revenue = metrics.netSales === null ? null : rc(metrics.netSales * (1 + input.priceChange / 100) * volume);
  const cogs = metrics.costOfGoodsSold === null ? null : rc(metrics.costOfGoodsSold * (1 + input.costChange / 100) * volume);
  const profit = revenue === null || cogs === null ? null : rc(revenue - cogs);
  const margin = profit !== null && revenue !== null && revenue > 0 ? rc(profit / revenue * 100) : null;
  const transactions = metrics.transactions === null ? null : Math.round(metrics.transactions * volume);
  const difference = { revenue: revenue === null || metrics.netSales === null ? null : rc(revenue - metrics.netSales),
    transactions: transactions === null || metrics.transactions === null ? null : transactions - metrics.transactions, profit: profit === null || metrics.grossProfit === null ? null : rc(profit - metrics.grossProfit),
    margin: margin === null || metrics.grossMargin === null ? null : rc(margin - metrics.grossMargin) };
  res.json({ success: true, data: { inputs: input, costBasis: metrics.costBasis, unavailableReason: metrics.unavailableReason,
    scenarios: {
      current: { revenue: metrics.netSales, transactions: metrics.transactions, avgTransaction: metrics.netSales === null || metrics.transactions === null ? null : metrics.transactions ? rc(metrics.netSales / metrics.transactions) : 0,
        cogs: metrics.costOfGoodsSold, profit: metrics.grossProfit, margin: metrics.grossMargin },
      projected: { revenue, transactions, avgTransaction: revenue === null || transactions === null ? null : transactions ? rc(revenue / transactions) : 0, cogs, profit, margin },
      difference,
    },
    insights: [ "Scenario estimate based on this month's recorded pre-tax sales and costs. Volume changes only by your input; no demand elasticity is assumed.",
      ...(metrics.unavailableReason ? [metrics.unavailableReason] : []),
      ...(difference.profit !== null ? ['Projected gross profit change: $' + difference.profit.toFixed(2)] : []),
    ],
  } });
});

/**
 * Get real-time metrics
 * GET /api/analytics/realtime
 */
export const getRealtimeMetrics = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationFilter = getLocationFilter(req, req.query.locationId as string);
  const salesScope = { ...locationFilter, ...(req.user?.role === 'CASHIER' ? { userId: req.user.id } : {}) };
  const calendar = await getReportCalendar(locationFilter);
  const now = calendar.now;
  const todayStart = calendar.day();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [
    todaySales,
    lastHourSales,
    pendingSales,
    activeShifts,
    recentTransactions
  ] = await Promise.all([
    getFinancialMetrics(salesScope, { gte: todayStart, lte: now }),
    getFinancialMetrics(salesScope, { gte: oneHourAgo, lte: now }),
    // Pending sales
    prisma.sale.count({
      where: { status: 'PENDING', ...salesScope },
    }),
    // Active shifts
    prisma.shift.count({
      where: { clockOutAt: null, ...salesScope },
    }),
    // Recent transactions
    prisma.sale.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      where: { status: { in: ['COMPLETED', 'REFUNDED'] }, createdAt: { lte: now }, ...salesScope },
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

  const lowStockCount = await prisma.product.count({
    where: {
      isActive: true,
      trackInventory: true,
      sku: { not: 'MISC-001' },
      stockQuantity: { lte: prisma.product.fields.lowStockAlert },
      ...locationFilter,
    },
  });

  const todayCount = todaySales.transactions;
  const todayTotal = todaySales.netCollected;

  res.json({
    success: true,
    data: {
      today: {
        revenue: todayTotal,
        profit: todaySales.grossProfit,
        transactions: todayCount,
        avgOrderValue: todayCount === null ? null : todayCount > 0 ? rc(todaySales.grossCollected / todayCount) : 0,
      },
      lastHour: {
        revenue: lastHourSales.netCollected,
        transactions: lastHourSales.transactions,
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
