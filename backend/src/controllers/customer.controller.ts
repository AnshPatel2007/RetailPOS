import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { businessConfig } from '../config/business.config';
import { assertOwnsRecord, assertCanReadRecord, getLocationFilter, getSharedOrOwnFilter, isSuperAdmin } from '../utils/locationFilter.util';
import { Prisma } from '@prisma/client';

/**
 * An email or phone identifies one customer within a store. Another store may
 * have the same person as its own customer, and is never told about this one.
 */
async function assertContactAvailable(locationId: string | null, contact: { email?: string | null; phone?: string | null }, exceptCustomerId?: string) {
  for (const [field, label] of [['email', 'email'], ['phone', 'phone number']] as const) {
    const value = contact[field];
    if (!value) continue;
    const existing = await prisma.customer.findFirst({ where: { [field]: value, locationId, ...(exceptCustomerId ? { id: { not: exceptCustomerId } } : {}) }, select: { id: true } });
    if (existing) throw new AppError(`Customer with this ${label} already exists`, 400);
  }
}

/**
 * Calculate loyalty tier based on points
 */
function calculateLoyaltyTier(points: number): string {
  const tiers = businessConfig.customer.loyaltyTiers;
  if (points >= tiers.GOLD.min) return 'GOLD';
  if (points >= tiers.SILVER.min) return 'SILVER';
  return 'BRONZE';
}

/**
 * Get all customers
 * GET /api/customers
 */
export const getCustomers = asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    page = 1,
    limit = 20,
    search = '',
    hasEmail,
    hasPhone,
    minSpent,
    locationId,
  } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  const where: any = { isActive: true, ...getSharedOrOwnFilter(req, locationId as string) };

  if (search) {
    where.OR = [
      { firstName: { contains: search as string, mode: 'insensitive' } },
      { lastName: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
      { phone: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  if (hasEmail === 'true') {
    where.email = { not: null };
  }

  if (hasPhone === 'true') {
    where.phone = { not: null };
  }

  if (minSpent) {
    where.totalSpent = { gte: parseFloat(minSpent as string) };
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        loyaltyPoints: true,
        loyaltyTier: true,
        totalSpent: true,
        visitCount: true,
        lastVisitAt: true,
        createdAt: true,
      },
      skip,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.customer.count({ where }),
  ]);

  res.json({
    success: true,
    data: customers,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * Get single customer
 * GET /api/customers/:id
 */
export const getCustomer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      sales: {
        select: {
          id: true,
          saleNumber: true,
          total: true,
          createdAt: true,
          status: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!customer) {
    throw new AppError('Customer not found', 404);
  }
  assertCanReadRecord(req, customer.locationId, 'Customer not found');

  res.json({
    success: true,
    data: customer,
  });
});

/**
 * Create customer
 * POST /api/customers
 */
export const createCustomer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = req.body;

  // Blank email must be stored as NULL — the column is unique, so a second
  // customer with '' would collide
  if (!data.email) {
    data.email = null;
  }

  // birthDate arrives as "yyyy-mm-dd" from the form; Prisma needs a Date
  if (data.birthDate === '') data.birthDate = null;
  if (typeof data.birthDate === 'string') data.birthDate = new Date(`${data.birthDate}T00:00:00`);

  // Non-SUPER_ADMIN is always forced to their own store, regardless of body
  data.locationId = isSuperAdmin(req) ? (data.locationId ?? null) : (req.user?.locationId ?? null);

  // An email or phone identifies one customer within a store; another store may
  // have the same person as its own customer.
  await assertContactAvailable(data.locationId, { email: data.email, phone: data.phone });

  const customer = await prisma.customer.create({
    data,
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.user?.id,
      action: 'CREATE',
      entity: 'CUSTOMER',
      entityId: customer.id,
      details: { customerName: `${customer.firstName} ${customer.lastName}` },
      locationId: customer.locationId,
    },
  });

  logger.info(`Customer created: ${customer.firstName} ${customer.lastName}`);

  res.status(201).json({
    success: true,
    data: customer,
    message: 'Customer created successfully',
  });
});

/**
 * Update customer
 * PUT /api/customers/:id
 */
export const updateCustomer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;
  if (req.user?.role === 'CASHIER' && (data.loyaltyPoints !== undefined || data.isActive !== undefined)) {
    throw new AppError('Manager permission is required to change loyalty balances or customer status', 403);
  }

  // Blank email must be stored as NULL (unique column — '' would collide)
  if (data.email === '') {
    data.email = null;
  }

  // birthDate arrives as "yyyy-mm-dd" from the form; Prisma needs a Date
  if (data.birthDate === '') data.birthDate = null;
  if (typeof data.birthDate === 'string') data.birthDate = new Date(`${data.birthDate}T00:00:00`);

  const customer = await prisma.customer.findUnique({ where: { id } });

  if (!customer) {
    throw new AppError('Customer not found', 404);
  }
  assertOwnsRecord(req, customer.locationId);
  // Non-SUPER_ADMIN can't reassign a customer to another store or make it chain-wide
  if (!isSuperAdmin(req)) {
    data.locationId = customer.locationId;
  }

  // Email and phone stay unique within the customer's store
  await assertContactAvailable(data.locationId ?? customer.locationId, {
    email: data.email && data.email !== customer.email ? data.email : null,
    phone: data.phone && data.phone !== customer.phone ? data.phone : null,
  }, id);

  const updatedCustomer = await prisma.customer.update({
    where: { id },
    data,
  });

  // Auto-update loyalty tier based on current points
  const newTier = calculateLoyaltyTier(updatedCustomer.loyaltyPoints);
  if (newTier !== updatedCustomer.loyaltyTier) {
    await prisma.customer.update({
      where: { id },
      data: { loyaltyTier: newTier },
    });
    updatedCustomer.loyaltyTier = newTier;
  }

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.user?.id,
      action: 'UPDATE',
      entity: 'CUSTOMER',
      entityId: id,
      details: { customerName: `${updatedCustomer.firstName} ${updatedCustomer.lastName}` },
      locationId: updatedCustomer.locationId,
    },
  });

  logger.info(`Customer updated: ${updatedCustomer.firstName} ${updatedCustomer.lastName}`);

  res.json({
    success: true,
    data: updatedCustomer,
    message: 'Customer updated successfully',
  });
});

/**
 * Delete customer (soft delete)
 * DELETE /api/customers/:id
 */
export const deleteCustomer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const customer = await prisma.customer.findUnique({ where: { id } });

  if (!customer) {
    throw new AppError('Customer not found', 404);
  }
  assertOwnsRecord(req, customer.locationId);

  // Soft delete
  await prisma.customer.update({
    where: { id },
    data: { isActive: false },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.user?.id,
      action: 'DELETE',
      entity: 'CUSTOMER',
      entityId: id,
      details: { customerName: `${customer.firstName} ${customer.lastName}` },
      locationId: customer.locationId,
    },
  });

  logger.info(`Customer deleted: ${customer.firstName} ${customer.lastName}`);

  res.json({
    success: true,
    message: 'Customer deleted successfully',
  });
});

/**
 * Get customer purchase history
 * GET /api/customers/:id/history
 */
export const getCustomerHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const customer = await prisma.customer.findUnique({ where: { id } });

  if (!customer) {
    throw new AppError('Customer not found', 404);
  }
  assertCanReadRecord(req, customer.locationId, 'Customer not found');

  const sales = await prisma.sale.findMany({
    where: { customerId: id },
    include: {
      items: {
        select: {
          productName: true,
          quantity: true,
          price: true,
          total: true,
        },
      },
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({
    success: true,
    data: sales,
  });
});

/**
 * Search customer by phone number
 * GET /api/customers/search/phone?phone={number}
 */
export const searchByPhone = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { phone } = req.query;

  if (!phone || typeof phone !== 'string') {
    throw new AppError('Phone number is required', 400);
  }

  const customerSelect = {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    loyaltyPoints: true,
    loyaltyTier: true,
    totalSpent: true,
    visitCount: true,
    locationId: true,
  } as const;

  // Only this store's customers are searched: another store's customer with the
  // same number (or the same last four digits) is neither linked nor counted.
  const { locationId } = getLocationFilter(req, req.query.locationId as string);
  const store = locationId ? Prisma.sql`"locationId" = ${locationId}` : Prisma.sql`TRUE`;

  // Exact match first — fast path using the store's unique index
  let customer = await prisma.customer.findFirst({
    where: { phone, ...(locationId ? { locationId } : {}) },
    select: customerSelect,
    orderBy: { id: 'asc' },
  });

  // Fallback: formatting-insensitive partial match (digits only, e.g. last 4),
  // linked only when the match is unambiguous
  const digits = phone.replace(/\D/g, '');
  if (!customer && digits.length >= 4) {
    const matches = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM customers
      WHERE ${store} AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE ${'%' + digits + '%'}
      LIMIT 2
    `;
    if (matches.length === 1) {
      customer = await prisma.customer.findUnique({
        where: { id: matches[0].id },
        select: customerSelect,
      });
    }
  }

  // A store shouldn't link a checkout to another store's private customer
  if (customer && !isSuperAdmin(req) && customer.locationId !== req.user!.locationId) {
    customer = null;
  }

  res.json({
    success: true,
    data: customer,
  });
});

/**
 * Send an email campaign to a customer segment
 * POST /api/customers/campaign  { segment, subject, message }
 */
export const sendCustomerCampaign = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { segment, subject, message, idempotencyKey } = z.object({ segment:z.string().trim().min(1).max(100),subject:z.string().trim().min(1).max(200),message:z.string().trim().min(1).max(10000),idempotencyKey:z.string().uuid() }).strict().parse(req.body);

  if (!segment || !subject?.trim() || !message?.trim()) {
    throw new AppError('Segment, subject, and message are required', 400);
  }

  const { sendCampaign } = await import('../services/marketing.service');
  const result = await sendCampaign(req, segment, subject, message, idempotencyKey);

  await prisma.activityLog.create({
    data: {
      userId: req.user!.id,
      action: 'CAMPAIGN',
      entity: 'CUSTOMER',
      details: { segment, subject, ...result },
      locationId: req.user?.locationId ?? null,
    },
  });

  res.json({
    success: true,
    ...result,
    message: 'Campaign queued. Review delivery jobs for provider results.',
  });
});

/**
 * Preview how many customers a campaign segment would reach
 * GET /api/customers/campaign/preview?segment=...
 */
export const previewCampaignSegment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { segment } = req.query;
  if (!segment) {
    throw new AppError('Segment is required', 400);
  }
  const { resolveSegment } = await import('../services/marketing.service');
  const recipients = await resolveSegment(String(segment), req.user!.locationId!);
  res.json({ success: true, data: { matched: recipients.length } });
});
