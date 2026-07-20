/**
 * Public API v1 — read-only endpoints authenticated by API key.
 * Deliberately lean: stable field names, cursorless pagination, no secrets.
 */

import { Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import prisma from '../config/database';
import { SaleStatus } from '@prisma/client';
import { ApiKeyRequest } from '../middleware/apiKeyAuth';
import { createDateFilter } from '../utils/dateFilter.util';

const paginate = (req: ApiKeyRequest) => {
  const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || 25), 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
};

/** GET /api/v1/products */
export const listProducts = asyncHandler(async (req: ApiKeyRequest, res: Response) => {
  const { page, limit, skip } = paginate(req);
  const { search, updatedSince, isActive } = req.query;

  const where: any = {};
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (search) {
    where.OR = [
      { name: { contains: String(search), mode: 'insensitive' } },
      { sku: { contains: String(search), mode: 'insensitive' } },
      { barcode: { contains: String(search) } },
    ];
  }
  if (updatedSince) {
    const since = new Date(String(updatedSince));
    if (!isNaN(since.getTime())) where.updatedAt = { gte: since };
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: {
        id: true, sku: true, name: true, description: true, barcode: true,
        price: true, cost: true, stockQuantity: true, isActive: true, isTaxable: true,
        minimumAge: true, ebtEligible: true, updatedAt: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  res.json({ success: true, data: products, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

/** GET /api/v1/products/:id */
export const getProduct = asyncHandler(async (req: ApiKeyRequest, res: Response) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, sku: true, name: true, description: true, barcode: true,
      price: true, cost: true, stockQuantity: true, isActive: true, isTaxable: true,
      minimumAge: true, ebtEligible: true, createdAt: true, updatedAt: true,
      category: { select: { id: true, name: true } },
    },
  });
  if (!product) {
    res.status(404).json({ success: false, error: 'Product not found' });
    return;
  }
  res.json({ success: true, data: product });
});

/** GET /api/v1/sales */
export const listSales = asyncHandler(async (req: ApiKeyRequest, res: Response) => {
  const { page, limit, skip } = paginate(req);
  const { startDate, endDate, status } = req.query;

  const where: any = {};
  const dateFilter = createDateFilter(String(startDate || ''), String(endDate || ''));
  if (dateFilter) where.createdAt = dateFilter;
  if (status) where.status = String(status);

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      select: {
        id: true, saleNumber: true, status: true, subtotal: true, tax: true,
        discount: true, surcharge: true, total: true, paymentMethod: true,
        createdAt: true, customerId: true,
        items: { select: { productId: true, sku: true, productName: true, quantity: true, price: true, discount: true, total: true } },
        payments: { select: { paymentMethod: true, amount: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.sale.count({ where }),
  ]);

  res.json({ success: true, data: sales, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

/** GET /api/v1/sales/:id */
export const getSale = asyncHandler(async (req: ApiKeyRequest, res: Response) => {
  const sale = await prisma.sale.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, saleNumber: true, status: true, subtotal: true, tax: true,
      discount: true, surcharge: true, total: true, paymentMethod: true,
      amountPaid: true, changeDue: true, createdAt: true, customerId: true,
      items: { select: { productId: true, sku: true, productName: true, quantity: true, price: true, discount: true, tax: true, total: true } },
      payments: { select: { paymentMethod: true, amount: true } },
      refunds: { select: { id: true, amount: true, reason: true, createdAt: true } },
    },
  });
  if (!sale) {
    res.status(404).json({ success: false, error: 'Sale not found' });
    return;
  }
  res.json({ success: true, data: sale });
});

/** GET /api/v1/customers */
export const listCustomers = asyncHandler(async (req: ApiKeyRequest, res: Response) => {
  const { page, limit, skip } = paginate(req);
  const { search } = req.query;

  const where: any = { isActive: true };
  if (search) {
    where.OR = [
      { firstName: { contains: String(search), mode: 'insensitive' } },
      { lastName: { contains: String(search), mode: 'insensitive' } },
      { phone: { contains: String(search) } },
    ];
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        loyaltyPoints: true, loyaltyTier: true, totalSpent: true, visitCount: true,
        tags: true, createdAt: true, lastVisitAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.customer.count({ where }),
  ]);

  res.json({ success: true, data: customers, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

/** GET /api/v1/summary — today at a glance, for external dashboards */
export const getSummary = asyncHandler(async (_req: ApiKeyRequest, res: Response) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [sales, refunds, lowStock] = await Promise.all([
    prisma.sale.aggregate({
      where: { status: { in: [SaleStatus.COMPLETED, SaleStatus.REFUNDED] }, createdAt: { gte: todayStart } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.refund.aggregate({
      where: { createdAt: { gte: todayStart } },
      _sum: { amount: true },
    }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM products
      WHERE "isActive" = true AND "trackInventory" = true
        AND "lowStockAlert" > 0 AND "stockQuantity" <= "lowStockAlert"
    `,
  ]);

  res.json({
    success: true,
    data: {
      date: todayStart.toISOString().slice(0, 10),
      netRevenue: Math.round(((sales._sum.total || 0) - (refunds._sum.amount || 0)) * 100) / 100,
      transactions: sales._count,
      lowStockProducts: Number(lowStock[0]?.count ?? 0),
    },
  });
});
