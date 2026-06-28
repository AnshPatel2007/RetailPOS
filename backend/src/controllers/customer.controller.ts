import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { businessConfig } from '../config/business.config';

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
export const getCustomers = asyncHandler(async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 20,
    search = '',
    hasEmail,
    hasPhone,
    minSpent,
  } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  const where: any = { isActive: true };

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
export const getCustomer = asyncHandler(async (req: Request, res: Response) => {
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

  // Check if email already exists
  if (data.email) {
    const existing = await prisma.customer.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw new AppError('Customer with this email already exists', 400);
    }
  }

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

  const customer = await prisma.customer.findUnique({ where: { id } });

  if (!customer) {
    throw new AppError('Customer not found', 404);
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
export const getCustomerHistory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const customer = await prisma.customer.findUnique({ where: { id } });

  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

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
export const searchByPhone = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.query;

  if (!phone || typeof phone !== 'string') {
    throw new AppError('Phone number is required', 400);
  }

  const customer = await prisma.customer.findUnique({
    where: { phone },
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
    },
  });

  res.json({
    success: true,
    data: customer,
  });
});
