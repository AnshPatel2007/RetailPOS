import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';

// Get all locations (super-admin only)
export const getAllLocations = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const locations = await prisma.location.findMany({
    include: {
      _count: {
        select: {
          users: true,
          products: true,
          sales: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  // Get sales totals for each location
  const locationsWithStats = await Promise.all(
    locations.map(async (location: any) => {
      const salesStats = await prisma.sale.aggregate({
        where: { locationId: location.id },
        _sum: { total: true },
        _count: true,
      });

      const todaySales = await prisma.sale.aggregate({
        where: {
          locationId: location.id,
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
        _sum: { total: true },
      });

      return {
        ...location,
        totalRevenue: salesStats._sum.total || 0,
        totalSales: salesStats._count,
        todayRevenue: todaySales._sum.total || 0,
      };
    })
  );

  res.json({ success: true, data: locationsWithStats });
});

// Get location by ID
export const getLocationById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const location = await prisma.location.findUnique({
    where: { id },
    include: {
      users: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          isActive: true,
        },
      },
      _count: {
        select: {
          products: true,
          sales: true,
          shifts: true,
          expenses: true,
        },
      },
    },
  });

  if (!location) {
    throw new AppError('Location not found', 404);
  }

  // Get additional stats
  const [salesStats, recentSales, activeShifts] = await Promise.all([
    prisma.sale.aggregate({
      where: { locationId: id },
      _sum: { total: true },
      _avg: { total: true },
    }),
    prisma.sale.findMany({
      where: { locationId: id },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: { firstName: true, lastName: true },
        },
      },
    }),
    prisma.shift.findMany({
      where: {
        locationId: id,
        clockOutAt: null,
      },
      include: {
        user: {
          select: { firstName: true, lastName: true },
        },
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      ...location,
      totalRevenue: salesStats._sum.total || 0,
      averageOrderValue: salesStats._avg.total || 0,
      recentSales,
      activeShifts,
    },
  });
});

// Create new location
export const createLocation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    name,
    address,
    city,
    state,
    zipCode,
    country,
    phone,
    email,
    taxRate,
    businessHours,
    currency,
    timezone,
  } = req.body;

  // Validate required fields
  if (!name || !address || !city || !state || !zipCode || !phone || !email) {
    throw new AppError('Missing required fields: name, address, city, state, zipCode, phone, email', 400);
  }

  const location = await prisma.location.create({
    data: {
      name,
      address,
      city,
      state,
      zipCode,
      country: country || 'US',
      phone,
      email,
      taxRate: taxRate || 0,
      businessHours,
      currency: currency || 'USD',
      timezone: timezone || 'America/New_York',
    },
  });

  res.status(201).json({ success: true, data: location });
});

// Update location
export const updateLocation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const updateData = req.body;

  const location = await prisma.location.update({
    where: { id },
    data: updateData,
  });

  res.json({ success: true, data: location });
});

// Delete (deactivate) location
export const deleteLocation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  // Check if location has active users
  const activeUsers = await prisma.user.count({
    where: { locationId: id, isActive: true },
  });

  if (activeUsers > 0) {
    throw new AppError(`Cannot delete location with ${activeUsers} active users. Reassign or deactivate users first.`, 400);
  }

  // Soft delete by setting isActive to false
  const location = await prisma.location.update({
    where: { id },
    data: { isActive: false },
  });

  res.json({ success: true, data: location, message: 'Location deactivated' });
});

// Get location stats for dashboard
export const getLocationStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { period = '30' } = req.query;

  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - parseInt(period as string));

  const [
    totalSales,
    periodSales,
    topProducts,
    userPerformance,
    expenseTotal,
  ] = await Promise.all([
    // Total sales
    prisma.sale.aggregate({
      where: { locationId: id },
      _sum: { total: true },
      _count: true,
    }),
    // Sales in period
    prisma.sale.aggregate({
      where: {
        locationId: id,
        createdAt: { gte: daysAgo },
      },
      _sum: { total: true },
      _count: true,
    }),
    // Top products
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: { locationId: id, createdAt: { gte: daysAgo } },
      },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 5,
    }),
    // User performance
    prisma.sale.groupBy({
      by: ['userId'],
      where: {
        locationId: id,
        createdAt: { gte: daysAgo },
      },
      _sum: { total: true },
      _count: true,
    }),
    // Expenses
    prisma.expense.aggregate({
      where: {
        locationId: id,
        createdAt: { gte: daysAgo },
      },
      _sum: { amount: true },
    }),
  ]);

  // Get product names for top products
  const productIds = topProducts.map((p: any) => p.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });

  const topProductsWithNames = topProducts.map((p: any) => ({
    ...p,
    productName: products.find((prod: any) => prod.id === p.productId)?.name || 'Unknown',
  }));

  // Get user names for performance
  const userIds = userPerformance.map((u: any) => u.userId).filter(Boolean) as string[];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });

  const userPerformanceWithNames = userPerformance.map((u: any) => ({
    ...u,
    userName: u.userId
      ? `${users.find((usr: any) => usr.id === u.userId)?.firstName || ''} ${users.find((usr: any) => usr.id === u.userId)?.lastName || ''}`.trim() || 'Unknown'
      : 'Unknown',
  }));

  res.json({
    success: true,
    data: {
      totalRevenue: totalSales._sum.total || 0,
      totalTransactions: totalSales._count,
      periodRevenue: periodSales._sum.total || 0,
      periodTransactions: periodSales._count,
      periodExpenses: expenseTotal._sum.amount || 0,
      periodProfit: (periodSales._sum.total || 0) - (expenseTotal._sum.amount || 0),
      topProducts: topProductsWithNames,
      userPerformance: userPerformanceWithNames,
    },
  });
});

// Get cross-location comparison (super-admin dashboard)
export const getCrossLocationStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { period = '30' } = req.query;

  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - parseInt(period as string));

  const locations = await prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const statsPromises = locations.map(async (location: any) => {
    const [
      sales,
      expenses,
      users,
      activeShifts,
      pendingSales,
      refundedSales,
      taxCollected,
    ] = await Promise.all([
      // Sales stats
      prisma.sale.aggregate({
        where: {
          locationId: location.id,
          createdAt: { gte: daysAgo },
          status: 'COMPLETED',
        },
        _sum: { total: true, tax: true },
        _count: true,
      }),
      // Expenses - use expenseDate and only APPROVED/PAID
      prisma.expense.aggregate({
        where: {
          locationId: location.id,
          expenseDate: { gte: daysAgo },
          status: { in: ['APPROVED', 'PAID'] },
        },
        _sum: { amount: true },
      }),
      // Active users
      prisma.user.count({
        where: { locationId: location.id, isActive: true },
      }),
      // Active shifts
      prisma.shift.count({
        where: {
          user: { locationId: location.id },
          clockOutAt: null,
        },
      }),
      // Pending/Hold sales
      prisma.sale.count({
        where: {
          locationId: location.id,
          status: { in: ['PENDING', 'HOLD'] },
        },
      }),
      // Refunded/Voided sales
      prisma.sale.aggregate({
        where: {
          locationId: location.id,
          createdAt: { gte: daysAgo },
          status: { in: ['REFUNDED', 'VOIDED'] },
        },
        _sum: { total: true },
        _count: true,
      }),
      // Tax collected
      prisma.sale.aggregate({
        where: {
          locationId: location.id,
          createdAt: { gte: daysAgo },
          status: 'COMPLETED',
        },
        _sum: { tax: true },
      }),
    ]);

    // Calculate low stock products count in memory
    const productsForLowStock = await prisma.product.findMany({
      where: {
        locationId: location.id,
        isActive: true,
        trackInventory: true,
      },
      select: {
        stockQuantity: true,
        lowStockAlert: true,
      },
    });
    const lowStockCount = productsForLowStock.filter(p => p.stockQuantity <= p.lowStockAlert).length;

    // Calculate inventory value manually (cost * quantity)
    const products = await prisma.product.findMany({
      where: { locationId: location.id, isActive: true },
      select: { cost: true, stockQuantity: true },
    });
    const totalInventoryValue = products.reduce(
      (sum: number, p: any) => sum + (p.cost * p.stockQuantity),
      0
    );

    return {
      locationId: location.id,
      locationName: location.name,
      revenue: sales._sum.total || 0,
      transactions: sales._count,
      expenses: expenses._sum.amount || 0,
      profit: (sales._sum.total || 0) - (expenses._sum.amount || 0),
      activeUsers: users,
      lowStockCount: lowStockCount,
      activeShifts: activeShifts,
      pendingSales: pendingSales,
      refundCount: refundedSales._count,
      refundAmount: refundedSales._sum.total || 0,
      taxCollected: taxCollected._sum.tax || 0,
      inventoryValue: totalInventoryValue,
    };
  });

  const locationStats = await Promise.all(statsPromises);

  // Get global metrics
  const [
    totalCustomers,
    newCustomers,
    topProducts,
    cashDiscrepancies,
  ] = await Promise.all([
    // Total customers
    prisma.customer.count({ where: { isActive: true } }),
    // New customers this period
    prisma.customer.count({
      where: { createdAt: { gte: daysAgo } },
    }),
    // Top products across all stores
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: { createdAt: { gte: daysAgo }, status: 'COMPLETED' },
      },
      _sum: { total: true, quantity: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 10,
    }),
    // Cash discrepancies from shifts
    prisma.shift.findMany({
      where: {
        clockOutAt: { gte: daysAgo },
        cashDifference: { not: 0 },
      },
      select: {
        cashDifference: true,
        user: { select: { firstName: true, lastName: true } },
        location: { select: { name: true } },
      },
      orderBy: { clockOutAt: 'desc' },
      take: 10,
    }),
  ]);

  // Get product names for top products
  const productIds = topProducts.map((p: any) => p.productId);
  const productDetails = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });

  const topProductsWithNames = topProducts.map((p: any) => {
    const product = productDetails.find((pd: any) => pd.id === p.productId);
    return {
      productId: p.productId,
      name: product?.name || 'Unknown',
      totalRevenue: p._sum.total || 0,
      totalQuantity: p._sum.quantity || 0,
    };
  });

  // Calculate totals
  const totals = locationStats.reduce(
    (acc: any, loc: any) => ({
      totalRevenue: acc.totalRevenue + loc.revenue,
      totalTransactions: acc.totalTransactions + loc.transactions,
      totalExpenses: acc.totalExpenses + loc.expenses,
      totalProfit: acc.totalProfit + loc.profit,
      totalUsers: acc.totalUsers + loc.activeUsers,
      totalLowStock: acc.totalLowStock + loc.lowStockCount,
      totalActiveShifts: acc.totalActiveShifts + loc.activeShifts,
      totalPendingSales: acc.totalPendingSales + loc.pendingSales,
      totalRefunds: acc.totalRefunds + loc.refundCount,
      totalRefundAmount: acc.totalRefundAmount + loc.refundAmount,
      totalTaxCollected: acc.totalTaxCollected + loc.taxCollected,
      totalInventoryValue: acc.totalInventoryValue + loc.inventoryValue,
    }),
    {
      totalRevenue: 0,
      totalTransactions: 0,
      totalExpenses: 0,
      totalProfit: 0,
      totalUsers: 0,
      totalLowStock: 0,
      totalActiveShifts: 0,
      totalPendingSales: 0,
      totalRefunds: 0,
      totalRefundAmount: 0,
      totalTaxCollected: 0,
      totalInventoryValue: 0,
    }
  );

  res.json({
    success: true,
    data: {
      locations: locationStats,
      totals,
      period: parseInt(period as string),
      // Additional global metrics
      globalMetrics: {
        totalCustomers,
        newCustomers,
        topProducts: topProductsWithNames,
        cashDiscrepancies,
      },
    },
  });
});
