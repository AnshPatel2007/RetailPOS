import { getAdminDashboard } from '../services/adminDashboard.service';
import { getFinancialMetrics, getProductFinancialMetrics, getFinancialBreakdowns } from '../services/financialMetrics.service';
import { reportCalendar } from '../services/reportDates.service';
import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { validateLocationAccess } from '../utils/locationFilter.util';
import { can } from '../policies/capabilities';
import { storeSettingsView } from '../validators/storeSettings.validator';

const storeSettingsSelect = { id: true, name: true, address: true, city: true, state: true, zipCode: true, phone: true, email: true, taxRate: true, cardSurchargePercent: true, timezone: true, isActive: true, settings: true, updatedAt: true } as const;
// One shape for store settings wherever they are returned (also with the checkout quote).
const publicLocationSettings = storeSettingsView;

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
  const { storeInfo, receiptSettings, paymentMethods, notificationSettings, cashControl } = req.body;
  if (paymentMethods && !can(req.user?.role, 'settings.financial')) throw new AppError('Only the store owner can change payment settings', 403);
  if (cashControl && !can(req.user?.role, 'settings.financial')) throw new AppError('Only the store owner can change cash control settings', 403);
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
      ...(cashControl ? { cashControl } : {}),
    };
    const saved = await tx.location.update({ where: { id: locationId }, data: update, select: storeSettingsSelect });
    await tx.activityLog.create({ data: { userId: req.user!.id, locationId, action: 'STORE_SETTINGS_UPDATED', entity: 'LOCATION', entityId: locationId,
      details: { sections: Object.keys(req.body).filter(key => key !== 'locationId'), ...(update.taxRate !== undefined ? { previousTaxRate: Number(current.taxRate), taxRate: update.taxRate } : {}) } } });
    return saved;
  });
  res.json({ success: true, data: publicLocationSettings(location) });
});

// Get all locations (super-admin only). Sales totals are added only when asked
// for (?include=stats), so store pickers do not pay for them.
export const getAllLocations = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locations = await prisma.location.findMany({
    include: { _count: { select: { users: true, products: true, sales: true } } },
    orderBy: { name: 'asc' },
  });
  if (req.query.include !== 'stats') { res.json({ success: true, data: locations }); return; }

  // The same booked-sales definition as the store dashboard: sales after refunds
  // and voids, with "today" starting at midnight in each store's own timezone.
  const now = new Date();
  const locationsWithStats = await Promise.all(locations.map(async location => {
    const calendar = reportCalendar(location.timezone || 'UTC', now);
    const [allTime, today] = await Promise.all([
      getFinancialMetrics({ locationId: location.id }, { lte: now }),
      getFinancialMetrics({ locationId: location.id }, { gte: calendar.day(), lte: now }),
    ]);
    return {
      ...location,
      totalRevenue: allTime.netCollected,
      totalSales: allTime.transactions ?? allTime.recordedReceiptCount,
      todayRevenue: today.netCollected,
      todayTransactions: today.transactions ?? today.recordedReceiptCount,
    };
  }));
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
// Only store details may be edited here; ids, settings and costing history are not.
const editableLocationFields = ['name', 'address', 'city', 'state', 'zipCode', 'country', 'phone', 'email', 'taxRate',
  'cardSurchargePercent', 'currency', 'timezone', 'businessHours', 'isActive'] as const;
export const updateLocation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const updateData: Record<string, unknown> = {};
  for (const field of editableLocationFields) if (req.body?.[field] !== undefined) updateData[field] = req.body[field];
  if (typeof updateData.timezone === 'string') {
    try { new Intl.DateTimeFormat('en-US', { timeZone: updateData.timezone }); }
    catch { throw new AppError('Choose a valid timezone', 400); }
  }
  if (updateData.isActive !== undefined && typeof updateData.isActive !== 'boolean') throw new AppError('Active must be true or false', 400);
  if (!await prisma.location.findUnique({ where: { id }, select: { id: true } })) throw new AppError('Location not found', 404);

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

// Get location stats for the platform store detail. Every figure comes from the
// shared booked-sales metrics, so it matches the store's own dashboard and P&L.
export const getLocationStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const days = Number(req.query.period ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new AppError('Choose a period between 1 and 366 days', 400);
  const location = await prisma.location.findUnique({ where: { id }, select: { id: true, timezone: true } });
  if (!location) throw new AppError('Location not found', 404);

  const now = new Date();
  const calendar = reportCalendar(location.timezone || 'UTC', now);
  // "Last N days" are whole store-local days, today included.
  const range = { gte: calendar.day(-(days - 1)), lte: now };
  const scope = { locationId: id };
  const [allTime, period, products, staff] = await Promise.all([
    getFinancialMetrics(scope, { lte: now }),
    getFinancialMetrics(scope, range),
    getProductFinancialMetrics(scope, range),
    getFinancialBreakdowns(scope, range, calendar.timezone, calendar.day(), prisma, ['employee']),
  ]);
  const userIds = staff.map(row => row.key).filter(Boolean);
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } });
  const nameOf = (userId: string) => {
    const user = users.find(candidate => candidate.id === userId);
    return user ? `${user.firstName} ${user.lastName}`.trim() : 'Unknown';
  };

  res.json({
    success: true,
    data: {
      timezone: calendar.timezone, rangeStart: range.gte, rangeEnd: now,
      totalRevenue: allTime.netCollected,
      totalTransactions: allTime.transactions,
      periodRevenue: period.netCollected,
      periodTransactions: period.transactions,
      periodExpenses: period.operatingExpenses,
      // Profit is shown only when every cost is known; otherwise the reason is given.
      // With open stock exceptions it is shown as not final, with the estimated part named.
      periodProfit: period.netProfit,
      profitUnavailableReason: period.netProfit === null ? period.unavailableReason : null,
      profitProvisionalReason: period.netProfit === null ? null : period.provisionalReason,
      averageOrderValue: period.transactions ? Math.round(period.grossCollected / period.transactions * 100) / 100 : null,
      topProducts: products.sort((a, b) => b.revenue - a.revenue || a.productId.localeCompare(b.productId)).slice(0, 5)
        .map(product => ({ productId: product.productId, name: product.productName, revenue: product.revenue, quantity: product.quantitySold })),
      userPerformance: staff.filter(row => row.total > 0).sort((a, b) => b.total - a.total)
        .map(row => ({ userId: row.key, userName: nameOf(row.key), total: row.total, transactions: row.count })),
    },
  });
});

// Get cross-location comparison (super-admin dashboard)
export const getCrossLocationStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await getAdminDashboard(req.query.period ?? '30') });
});
