import { getAdminDashboard } from '../services/adminDashboard.service';
import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { validateLocationAccess } from '../utils/locationFilter.util';
import { can } from '../policies/capabilities';
import { publicStoreSettings } from '../validators/storeSettings.validator';

const storeSettingsSelect = { id: true, name: true, address: true, city: true, state: true, zipCode: true, phone: true, email: true, taxRate: true, cardSurchargePercent: true, timezone: true, isActive: true, settings: true } as const;
const publicLocationSettings = <T extends { settings: unknown }>(location: T) => ({ ...location, settings: publicStoreSettings(location.settings) });

// Store settings always require an explicit store for platform preview.
export const getMyStoreSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = req.user?.role === 'SUPER_ADMIN' ? req.query.locationId : req.query.locationId || req.user?.locationId;
  if (typeof locationId !== 'string' || !locationId) throw new AppError('Select a store to view its settings', 400);
  validateLocationAccess(req, locationId);
  const location = await prisma.location.findUnique({ where: { id: locationId }, select: storeSettingsSelect });
  if (!location) throw new AppError('Location not found', 404);
  res.json({ success: true, data: publicLocationSettings(location) });
});

export const updateMyStoreSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = req.user?.locationId;
  if (!locationId) throw new AppError('A store assignment is required', 403);
  if (req.body.locationId && req.body.locationId !== locationId) throw new AppError('Cannot update settings for another location', 403);
  if (!can(req.user?.role, 'settings.operational')) throw new AppError('Store settings are read-only', 403);
  const { storeInfo, receiptSettings, paymentMethods, notificationSettings } = req.body;
  if (paymentMethods && !can(req.user?.role, 'settings.financial')) throw new AppError('Only the store owner can change payment settings', 403);
  const location = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM locations WHERE id = ${locationId} FOR UPDATE`;
    const current = await tx.location.findUnique({ where: { id: locationId } });
    if (!current) throw new AppError('Location not found', 404);
    if (!current.isActive) throw new AppError('This store is inactive. Settings are read-only.', 409);
    if (storeInfo?.taxRate !== undefined && Number(current.taxRate) !== storeInfo.taxRate && !can(req.user?.role, 'settings.financial')) throw new AppError('Only the store owner can change tax settings', 403);
    const update: Record<string, any> = {};
    if (storeInfo) for (const [input, field] of Object.entries({ storeName: 'name', address: 'address', city: 'city', state: 'state', phone: 'phone', taxRate: 'taxRate' })) {
      if (storeInfo[input] !== undefined) update[field] = storeInfo[input];
    }
    const existing = current.settings && typeof current.settings === 'object' && !Array.isArray(current.settings) ? current.settings : {};
    update.settings = { ...existing,
      ...(receiptSettings ? { receiptSettings } : {}),
      ...(paymentMethods ? { paymentMethods } : {}),
      ...(notificationSettings ? { notificationSettings } : {}),
    };
    const saved = await tx.location.update({ where: { id: locationId }, data: update, select: storeSettingsSelect });
    await tx.activityLog.create({ data: { userId: req.user!.id, locationId, action: 'STORE_SETTINGS_UPDATED', entity: 'LOCATION', entityId: locationId,
      details: { sections: Object.keys(req.body).filter(key => key !== 'locationId'), ...(update.taxRate !== undefined ? { previousTaxRate: Number(current.taxRate), taxRate: update.taxRate } : {}) } } });
    return saved;
  });
  res.json({ success: true, data: publicLocationSettings(location) });
});

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

  validateLocationAccess(req, id);

  // Register lookups need configuration, not another cashier's activity or staff directory.
  if (req.user?.role !== 'SUPER_ADMIN') {
    const location = await prisma.location.findUnique({ where: { id }, select: storeSettingsSelect });
    if (!location) throw new AppError('Location not found', 404);
    const activeShifts = req.user?.role === 'CASHIER' ? await prisma.shift.findMany({ where: { locationId: id, userId: req.user.id, isClosed: false }, select: { id: true, clockInAt: true, clockOutAt: true } }) : [];
    res.json({ success: true, data: { ...publicLocationSettings(location), activeShifts } });
    return;
  }

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
      // This endpoint is also available to cashiers. Never expose colleagues' wage snapshots.
      select: {
        id: true,
        userId: true,
        locationId: true,
        clockInAt: true,
        clockOutAt: true,
        startingCash: true,
        endingCash: true,
        expectedCash: true,
        cashDifference: true,
        totalSales: true,
        totalTransactions: true,
        isClosed: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
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
    cardSurchargePercent,
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
      cardSurchargePercent: cardSurchargePercent || 0,
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
      periodProfit: Number((periodSales._sum.total || 0)) - Number((expenseTotal._sum.amount || 0)),
      topProducts: topProductsWithNames,
      userPerformance: userPerformanceWithNames,
    },
  });
});

// Get cross-location comparison (super-admin dashboard)
export const getCrossLocationStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await getAdminDashboard(req.query.period ?? '30') });
});
