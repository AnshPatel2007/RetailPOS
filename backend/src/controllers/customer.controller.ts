import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { businessConfig } from '../config/business.config';
import { assertOwnsRecord, assertCanReadRecord, getSharedOrOwnFilter, isSuperAdmin } from '../utils/locationFilter.util';

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

  // Check if email already exists
  if (data.email) {
    const existing = await prisma.customer.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw new AppError('Customer with this email already exists', 400);
    }
  }

  // Non-SUPER_ADMIN is always forced to their own store, regardless of body
  data.locationId = isSuperAdmin(req) ? (data.locationId ?? null) : (req.user?.locationId ?? null);

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

  // Check email uniqueness if changing
  if (data.email && data.email !== customer.email) {
    const existing = await prisma.customer.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw new AppError('Customer with this email already exists', 400);
    }
  }

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

  // Exact match first — fast path using the unique index
  let customer = await prisma.customer.findUnique({
    where: { phone },
    select: customerSelect,
  });

  // Fallback: formatting-insensitive partial match (digits only, e.g. last 4),
  // linked only when the match is unambiguous
  const digits = phone.replace(/\D/g, '');
  if (!customer && digits.length >= 4) {
    const matches = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM customers
      WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE ${'%' + digits + '%'}
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
  if (customer && !isSuperAdmin(req) && customer.locationId !== null && customer.locationId !== req.user!.locationId) {
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
  const { segment, subject, message } = req.body;

  if (!segment || !subject?.trim() || !message?.trim()) {
    throw new AppError('Segment, subject, and message are required', 400);
  }

  const { sendCampaign } = await import('../services/marketing.service');
  const result = await sendCampaign(String(segment), String(subject).trim(), String(message).trim());

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
    data: result,
    message:
      result.matched === 0
        ? 'No opted-in customers matched this segment'
        : `Sent to ${result.sent} of ${result.matched} matched customer${result.matched !== 1 ? 's' : ''}${result.failed > 0 ? ` (${result.failed} failed)` : ''}`,
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
  const recipients = await resolveSegment(String(segment));
  res.json({ success: true, data: { matched: recipients.length } });
});
