import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { resolveWriteLocation } from '../utils/locationFilter.util';
import { pickRule, priceMetrics, priceReview, ROUNDINGS, RULE_SCOPES, Rounding, storeRules, suggestPrice } from '../services/pricing.service';

/** Pricing rules (target margins), price suggestions and the price review list. */
const store = (req: AuthRequest) => resolveWriteLocation(req, (req.query.locationId as string) || req.body?.locationId);

export const listRules = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = store(req);
  const rules = await storeRules(prisma, locationId);
  const [categories, products, units] = await Promise.all([
    prisma.category.findMany({ where: { id: { in: rules.filter(rule => rule.scope === 'CATEGORY').map(rule => rule.scopeId) } }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { id: { in: rules.filter(rule => rule.scope === 'PRODUCT').map(rule => rule.scopeId) } }, select: { id: true, name: true } }),
    prisma.productSellingUnit.findMany({ where: { id: { in: rules.filter(rule => rule.scope === 'SELLING_UNIT').map(rule => rule.scopeId) } }, select: { id: true, name: true, product: { select: { name: true } } } }),
  ]);
  const label = (scope: string, scopeId: string) => scope === 'STORE' ? 'All products'
    : scope === 'CATEGORY' ? categories.find(row => row.id === scopeId)?.name ?? 'Deleted category'
    : scope === 'PRODUCT' ? products.find(row => row.id === scopeId)?.name ?? 'Deleted product'
    : scope === 'SELLING_UNIT' ? (() => { const unit = units.find(row => row.id === scopeId); return unit ? `${unit.product.name} (${unit.name})` : 'Deleted pack'; })()
    : scopeId;
  res.json({ success: true, data: rules.map(rule => ({ id: rule.id, scope: rule.scope, scopeId: rule.scopeId, label: label(rule.scope, rule.scopeId),
    targetMargin: Number(rule.targetMargin), minMargin: rule.minMargin === null ? null : Number(rule.minMargin), rounding: rule.rounding })) });
});

const ruleBody = z.object({
  scope: z.enum(RULE_SCOPES),
  scopeId: z.string().trim().max(120).optional().default(''),
  targetMargin: z.number().min(0).lt(1),
  minMargin: z.number().min(0).lt(1).nullable().optional(),
  rounding: z.enum(ROUNDINGS).default('CENT'),
}).refine(body => (body.scope === 'STORE') === (body.scopeId === ''), { message: 'Choose what this rule applies to', path: ['scopeId'] })
  .refine(body => body.minMargin == null || body.minMargin <= body.targetMargin, { message: 'The minimum margin cannot be above the target', path: ['minMargin'] });

export const saveRule = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = ruleBody.parse(req.body);
  const locationId = store(req);
  // Brands are matched by name, ignoring case.
  const scopeId = body.scope === 'BRAND' ? body.scopeId.toLowerCase() : body.scopeId;
  if (body.scope === 'CATEGORY' && !await prisma.category.findFirst({ where: { id: scopeId, OR: [{ locationId }, { locationId: null }] } })) throw new AppError('Category not found', 404);
  if (body.scope === 'PRODUCT' && !await prisma.product.findFirst({ where: { id: scopeId, locationId } })) throw new AppError('Product not found', 404);
  if (body.scope === 'SELLING_UNIT' && !await prisma.productSellingUnit.findFirst({ where: { id: scopeId, locationId } })) throw new AppError('Pack not found', 404);
  const data = { targetMargin: body.targetMargin, minMargin: body.minMargin ?? null, rounding: body.rounding };
  const rule = await prisma.priceRule.upsert({ where: { locationId_scope_scopeId: { locationId, scope: body.scope, scopeId } },
    create: { locationId, scope: body.scope, scopeId, ...data }, update: data });
  res.json({ success: true, data: { ...rule, targetMargin: Number(rule.targetMargin), minMargin: rule.minMargin === null ? null : Number(rule.minMargin) } });
});

export const deleteRule = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = store(req);
  const deleted = await prisma.priceRule.deleteMany({ where: { id: req.params.id, locationId } });
  if (!deleted.count) throw new AppError('Rule not found', 404);
  res.json({ success: true });
});

/**
 * Suggested price for a product or pack (or a product being created, by its
 * category and brand), from the rule that applies and the given or current cost.
 */
export const suggest = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = store(req);
  const query = z.object({ productId: z.string().optional(), sellingUnitId: z.string().optional(), categoryId: z.string().optional(),
    brand: z.string().optional(), cost: z.coerce.number().min(0).optional(), price: z.coerce.number().min(0).optional() }).parse(req.query);
  let item = { productId: query.productId ?? null, sellingUnitId: query.sellingUnitId ?? null, categoryId: query.categoryId ?? null, brand: query.brand ?? null };
  if (query.productId) {
    const product = await prisma.product.findFirst({ where: { id: query.productId, locationId }, select: { categoryId: true, brand: true } });
    if (!product) throw new AppError('Product not found', 404);
    item = { ...item, categoryId: query.categoryId ?? product.categoryId, brand: query.brand ?? product.brand };
  }
  const picked = pickRule(await storeRules(prisma, locationId), item);
  const suggestion = picked && query.cost !== undefined ? suggestPrice(query.cost, picked.rule.targetMargin, picked.rule.rounding as Rounding) : null;
  const current = query.price !== undefined && query.cost !== undefined ? priceMetrics(query.price, query.cost) : null;
  const minMargin = picked?.rule.minMargin == null ? null : Number(picked.rule.minMargin);
  res.json({ success: true, data: {
    rule: picked ? { id: picked.rule.id, source: picked.source, targetMargin: Number(picked.rule.targetMargin), minMargin, rounding: picked.rule.rounding } : null,
    suggestion, current,
    warnings: current === null ? [] : [
      ...(query.price! < query.cost! ? ['Price is below cost'] : []),
      ...(minMargin !== null && current.margin !== null && current.margin < minMargin && query.price! >= query.cost! ? [`Margin is below the ${Math.round(minMargin * 1000) / 10}% minimum`] : []),
    ],
  } });
});

export const getPriceReview = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await priceReview(prisma, store(req)) });
});

const applyBody = z.object({ changes: z.array(z.object({
  productId: z.string().min(1), sellingUnitId: z.string().nullable().optional(),
  price: z.number().gt(0).max(1_000_000), expectedPrice: z.number().min(0),
})).min(1).max(500) });

/** Apply reviewed prices. Each change must still match the price the owner saw. */
export const applyPrices = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { changes } = applyBody.parse(req.body);
  const locationId = store(req);
  const applied = await prisma.$transaction(async tx => {
    let count = 0;
    for (const change of changes) {
      if (change.sellingUnitId) {
        const unit = await tx.productSellingUnit.findFirst({ where: { id: change.sellingUnitId, productId: change.productId, locationId } });
        if (!unit) throw new AppError('Pack not found', 404);
        if (Math.abs(Number(unit.price) - change.expectedPrice) > 0.00005) throw new AppError(`The price of ${unit.name} changed. Reload the review.`, 409);
        await tx.productSellingUnit.update({ where: { id: unit.id }, data: { price: change.price, version: { increment: 1 } } });
      } else {
        const product = await tx.product.findFirst({ where: { id: change.productId, locationId } });
        if (!product) throw new AppError('Product not found', 404);
        if (Math.abs(Number(product.price) - change.expectedPrice) > 0.00005) throw new AppError(`The price of ${product.name} changed. Reload the review.`, 409);
        await tx.product.update({ where: { id: product.id }, data: { price: change.price } });
      }
      count++;
    }
    return count;
  });
  res.json({ success: true, data: { applied } });
});
