import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { getLocationFilter } from '../utils/locationFilter.util';

/**
 * Inventory > Packs. Two kinds, listed together:
 * - a pack of one item (a carton of 10, a 12-pack): it shares the item's stock,
 *   so "available" is how many whole packs that stock makes, and its cost is
 *   the item's cost times the pack's count;
 * - a variety pack: its own product with its own stock, opened into the items inside.
 */
const query = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  locationId: z.string().optional(),
});

export const getPacks = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { search, page, limit, locationId: requested } = query.parse(req.query);
  const locationId = getLocationFilter(req, requested).locationId as string | undefined;
  if (!locationId) throw new AppError('Select a store to see its packs', 400);
  const text = search ? { contains: search, mode: Prisma.QueryMode.insensitive } : undefined;

  const [units, varieties] = await Promise.all([
    prisma.productSellingUnit.findMany({
      where: { locationId, isActive: true, ...(text ? { OR: [{ name: text }, { barcode: text }, { sku: text }, { product: { name: text } }] } : {}) },
      include: { product: { select: { id: true, name: true, cost: true, stockQuantity: true, baseUnitName: true, isActive: true } } },
    }),
    prisma.product.findMany({
      where: { locationId, bundleComponents: { some: {} }, ...(text ? { OR: [{ name: text }, { barcode: text }, { sku: text }] } : {}) },
      include: { bundleComponents: { include: { component: { select: { name: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    }),
  ]);

  const rows = [
    ...units.map(unit => ({
      kind: 'PACK' as const, id: unit.id, productId: unit.productId, name: unit.name, containsName: unit.product.name,
      unitsPerPackage: unit.unitsPerPackage, baseUnitName: unit.product.baseUnitName, barcode: unit.barcode, sku: unit.sku,
      price: Number(unit.price), packCost: Number(new Prisma.Decimal(unit.product.cost).mul(unit.unitsPerPackage).toDecimalPlaces(2)),
      available: Math.max(0, Math.floor(unit.product.stockQuantity / unit.unitsPerPackage)), sealedQuantity: unit.sealedQuantity,
      isActive: unit.isActive && unit.product.isActive,
    })),
    ...varieties.map(product => ({
      kind: 'VARIETY' as const, id: product.id, productId: product.id, name: product.name, barcode: product.barcode, sku: product.sku,
      price: Number(product.price), packCost: Number(product.cost), stockQuantity: product.stockQuantity, isActive: product.isActive,
      itemsPerPack: product.bundleComponents.reduce((sum, row) => sum + row.quantity, 0),
      contents: product.bundleComponents.map(row => ({ name: row.component.name, quantity: row.quantity })),
    })),
  ].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  res.json({
    success: true,
    data: rows.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / limit)) },
  });
});
