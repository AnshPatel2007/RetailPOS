import { Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { resolveWriteLocation } from '../utils/locationFilter.util';
import { assertSellingIdentifiersAvailable, lockPackagingProduct, packagingSummary, setPackageCount } from '../services/productSellingUnit.service';

/**
 * Connected packaging: one product (the base unit, e.g. a can) can be sold as
 * packs (a 12-pack with its own barcode and price). Every pack draws from the
 * same base-unit stock; unopened packs are tracked as a sub-count of it.
 */
type SupplierCase = { supplierId: string; supplierSku: string | null; cost: unknown; minOrder: number | null; leadTime: number | null;
  packSize: number; packCost: unknown; packBarcode: string | null; supplier: { name: string } };
const summary = (product: Parameters<typeof packagingSummary>[0] & { suppliers?: SupplierCase[] }) => {
  const view = packagingSummary(product);
  return { productId: product.id, baseUnitName: product.baseUnitName, stockQuantity: product.stockQuantity, stockVersion: product.stockVersion,
    looseStockQuantity: view.looseStockQuantity, sellingUnits: [...view.sellingUnits].sort((a, b) => a.unitsPerPackage - b.unitsPerPackage),
    // How each supplier sells it (e.g. a case of 24): used to order in cases.
    suppliers: (product.suppliers || []).map(link => ({ supplierId: link.supplierId, supplierName: link.supplier.name, supplierSku: link.supplierSku,
      packSize: link.packSize, packCost: link.packCost == null ? null : Number(link.packCost), cost: link.cost == null ? null : Number(link.cost),
      packBarcode: link.packBarcode, minOrder: link.minOrder, leadTime: link.leadTime })) };
};
const withPackaging = { sellingUnits: true, suppliers: { include: { supplier: { select: { name: true } } } } } as const;

async function readProduct(req: AuthRequest) {
  const product = await prisma.product.findUnique({ where: { id: req.params.id }, include: withPackaging });
  if (!product || (req.user!.role !== 'SUPER_ADMIN' && product.locationId !== req.user!.locationId)) throw new AppError('Product not found', 404);
  return product;
}

export const getPackaging = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: summary(await readProduct(req)) });
});

const unitName = z.string().trim().min(1).max(60);
const barcode = z.string().trim().min(3).max(100);
const createBody = z.object({
  name: unitName, barcode, sku: z.string().trim().max(100).optional(),
  unitsPerPackage: z.number().int().min(2).max(100000), price: z.number().gt(0).max(1_000_000),
  baseUnitName: z.string().trim().min(1).max(30).optional(), requestKey: z.string().trim().min(8).max(100).optional(),
});

export const createSellingUnit = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = createBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  const product = await prisma.$transaction(async tx => {
    const current = await lockPackagingProduct(tx, req.params.id, locationId);
    if (!current.trackInventory) throw new AppError('Packs need a product whose stock is tracked', 400);
    const requestKey = body.requestKey ?? randomUUID();
    const replay = await tx.productSellingUnit.findFirst({ where: { locationId, createRequestKey: requestKey } });
    if (!replay) {
      if (current.sellingUnits.some(unit => unit.unitsPerPackage === body.unitsPerPackage && unit.isActive))
        throw new AppError(`A ${body.unitsPerPackage}-unit pack already exists for this product`, 409);
      await assertSellingIdentifiersAvailable(tx, { locationId, barcode: body.barcode, sku: body.sku || null });
      await tx.productSellingUnit.create({ data: { productId: current.id, locationId, name: body.name, barcode: body.barcode, sku: body.sku || null,
        unitsPerPackage: body.unitsPerPackage, price: body.price, createRequestKey: requestKey } });
      if (body.baseUnitName) await tx.product.update({ where: { id: current.id }, data: { baseUnitName: body.baseUnitName } });
    }
    return tx.product.findUniqueOrThrow({ where: { id: current.id }, include: withPackaging });
  });
  res.status(201).json({ success: true, data: summary(product) });
});

const updateBody = z.object({
  name: unitName.optional(), barcode: barcode.optional(), sku: z.string().trim().max(100).nullable().optional(),
  price: z.number().gt(0).max(1_000_000).optional(), isActive: z.boolean().optional(), expectedVersion: z.number().int().min(0),
});

export const updateSellingUnit = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = updateBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  const product = await prisma.$transaction(async tx => {
    const current = await lockPackagingProduct(tx, req.params.id, locationId);
    const unit = current.sellingUnits.find(candidate => candidate.id === req.params.unitId);
    if (!unit) throw new AppError('Pack not found', 404);
    if (unit.version !== body.expectedVersion) throw new AppError('This pack changed. Reload and try again.', 409);
    if (body.isActive === false && unit.sealedQuantity > 0) throw new AppError(`Open or count the ${unit.sealedQuantity} unopened ${unit.name} before retiring it`, 409);
    await assertSellingIdentifiersAvailable(tx, { locationId, barcode: body.barcode ?? null, sku: body.sku ?? null, excludeSellingUnitId: unit.id });
    await tx.productSellingUnit.update({ where: { id: unit.id }, data: {
      ...(body.name !== undefined ? { name: body.name } : {}), ...(body.barcode !== undefined ? { barcode: body.barcode } : {}),
      ...(body.sku !== undefined ? { sku: body.sku || null } : {}), ...(body.price !== undefined ? { price: body.price } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}), version: { increment: 1 } } });
    return tx.product.findUniqueOrThrow({ where: { id: current.id }, include: withPackaging });
  });
  res.json({ success: true, data: summary(product) });
});

export const updateBaseUnitName = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { baseUnitName } = z.object({ baseUnitName: z.string().trim().min(1).max(30) }).parse(req.body);
  const locationId = resolveWriteLocation(req);
  const product = await prisma.$transaction(async tx => {
    const current = await lockPackagingProduct(tx, req.params.id, locationId);
    await tx.product.update({ where: { id: current.id }, data: { baseUnitName } });
    return tx.product.findUniqueOrThrow({ where: { id: current.id }, include: withPackaging });
  });
  res.json({ success: true, data: summary(product) });
});

const packagingBody = z.object({
  action: z.enum(['count', 'open']), quantity: z.number().int().min(0).max(100000),
  expectedVersion: z.number().int().min(0), expectedStockVersion: z.number().int().min(0),
  requestKey: z.string().trim().min(8).max(100), reason: z.string().trim().max(500).optional(),
});

/** Open unopened packs onto the shelf, or record how many are still sealed. Never changes total stock. */
export const changePackaging = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = packagingBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  if (body.action === 'open' && body.quantity === 0) throw new AppError('Open at least one pack', 400);
  await prisma.$transaction(tx => setPackageCount(tx, { productId: req.params.id, locationId, sellingUnitId: req.params.unitId, userId: req.user!.id,
    quantity: body.quantity, action: body.action, expectedVersion: body.expectedVersion, expectedStockVersion: body.expectedStockVersion,
    requestKey: body.requestKey, notes: body.reason }));
  res.json({ success: true, data: summary(await readProduct(req)) });
});
