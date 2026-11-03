import { Prisma, PriceRule } from '@prisma/client';
import { AppError } from '../utils/errorHandler';

/**
 * Target-margin pricing (spec sections 13-14).
 *
 *   margin = (price - cost) / price        e.g. $1.50 cost, $2.15 price -> 30.23%
 *   markup = (price - cost) / cost         same item                      -> 43.33%
 *
 * A suggested price is cost / (1 - target margin), rounded UP to the store's
 * price ending, so rounding never takes an item below its target. Prices are
 * only ever suggested; the owner applies them.
 */
export const ROUNDINGS = ['CENT', 'NICKEL', 'NINE', 'NINETY_NINE'] as const;
export type Rounding = typeof ROUNDINGS[number];
export const RULE_SCOPES = ['STORE', 'CATEGORY', 'BRAND', 'PRODUCT', 'SELLING_UNIT'] as const;
export type RuleScope = typeof RULE_SCOPES[number];

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/** Round a price up to the next allowed ending (in cents). */
export function roundUp(price: Prisma.Decimal.Value, rounding: Rounding): number {
  const cents = D(price).mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_UP).toNumber();
  const ending = rounding === 'NICKEL' ? Math.ceil(cents / 5) * 5
    : rounding === 'NINE' ? cents + ((9 - (cents % 10)) + 10) % 10
    : rounding === 'NINETY_NINE' ? cents + ((99 - (cents % 100)) + 100) % 100
    : cents;
  return ending / 100;
}

/** Margin, markup and profit for one unit, each clearly labelled. */
export function priceMetrics(price: Prisma.Decimal.Value, cost: Prisma.Decimal.Value | null) {
  if (cost === null) return { margin: null, markup: null, grossProfit: null };
  const p = D(price), c = D(cost);
  return {
    margin: p.gt(0) ? Number(p.minus(c).div(p).toDecimalPlaces(4)) : null,
    markup: c.gt(0) ? Number(p.minus(c).div(c).toDecimalPlaces(4)) : null,
    grossProfit: Number(p.minus(c).toDecimalPlaces(4)),
  };
}

export function suggestPrice(cost: Prisma.Decimal.Value, targetMargin: Prisma.Decimal.Value, rounding: Rounding = 'CENT') {
  const m = D(targetMargin);
  if (m.lt(0) || m.gte(1)) throw new AppError('Target margin must be at least 0% and below 100%', 400);
  const c = D(cost);
  if (c.lte(0)) return null;
  const raw = c.div(D(1).minus(m));
  const price = roundUp(raw, rounding);
  return { cost: Number(c.toDecimalPlaces(4)), targetMargin: Number(m), rawPrice: Number(raw.toDecimalPlaces(4)), price, ...priceMetrics(price, c) };
}

type RuleDb = Pick<Prisma.TransactionClient, 'priceRule'>;
export interface PricedItem { productId?: string | null; sellingUnitId?: string | null; categoryId?: string | null; brand?: string | null }
const SOURCE: Record<RuleScope, string> = { SELLING_UNIT: 'pack', PRODUCT: 'product', BRAND: 'brand', CATEGORY: 'category', STORE: 'store default' };

/** Most specific rule wins: pack, product, brand, category, then the store default. */
export function pickRule(rules: PriceRule[], item: PricedItem) {
  const candidates: [RuleScope, string | null | undefined][] = [
    ['SELLING_UNIT', item.sellingUnitId], ['PRODUCT', item.productId], ['BRAND', item.brand?.trim().toLowerCase()], ['CATEGORY', item.categoryId], ['STORE', ''],
  ];
  for (const [scope, scopeId] of candidates) {
    if (scopeId === null || scopeId === undefined) continue;
    const rule = rules.find(candidate => candidate.scope === scope && candidate.scopeId === scopeId);
    if (rule) return { rule, source: SOURCE[scope] };
  }
  return null;
}

export const storeRules = (db: RuleDb, locationId: string) => db.priceRule.findMany({ where: { locationId } });

type ReviewDb = Pick<Prisma.TransactionClient, 'priceRule' | 'product' | 'inventoryValuation'>;

/** Unit cost used for pricing: on-hand average, then the last cost paid, then the catalog cost. */
function costBasis(product: { stockQuantity: number; cost: Prisma.Decimal }, balance?: { quantity: number; value: Prisma.Decimal | null; lastUnitCost: Prisma.Decimal | null }) {
  if (balance && balance.quantity > 0 && balance.value !== null && balance.value.gt(0)) return { cost: balance.value.div(balance.quantity), basis: 'AVERAGE' as const };
  if (balance?.lastUnitCost && balance.lastUnitCost.gt(0)) return { cost: balance.lastUnitCost, basis: 'LAST_COST' as const };
  if (D(product.cost).gt(0)) return { cost: D(product.cost), basis: 'CATALOG' as const };
  return null;
}

/**
 * Items priced below cost, below their minimum margin, or under their target
 * margin, with a suggested price. Shown after costs change; never applied
 * automatically.
 */
export async function priceReview(db: ReviewDb, locationId: string) {
  const [rules, products] = await Promise.all([
    storeRules(db, locationId),
    db.product.findMany({ where: { locationId, isActive: true, sku: { not: 'MISC-001' }, priceEmbedded: false },
      select: { id: true, name: true, sku: true, price: true, cost: true, stockQuantity: true, categoryId: true, brand: true,
        sellingUnits: { where: { isActive: true }, select: { id: true, name: true, price: true, unitsPerPackage: true, version: true } } } }),
  ]);
  const balances = await db.inventoryValuation.findMany({ where: { productId: { in: products.map(product => product.id) } } });
  const rows = [];
  for (const product of products) {
    const basis = costBasis(product, balances.find(balance => balance.productId === product.id));
    if (!basis) continue;
    const items = [
      { sellingUnitId: null as string | null, name: product.name, price: product.price, unitCost: basis.cost, version: null as number | null },
      ...product.sellingUnits.map(unit => ({ sellingUnitId: unit.id, name: `${product.name} (${unit.name})`, price: unit.price, unitCost: basis.cost.mul(unit.unitsPerPackage), version: unit.version })),
    ];
    for (const item of items) {
      const picked = pickRule(rules, { productId: product.id, sellingUnitId: item.sellingUnitId, categoryId: product.categoryId, brand: product.brand });
      const metrics = priceMetrics(item.price, item.unitCost);
      const margin = metrics.margin ?? -1;
      const target = picked ? Number(picked.rule.targetMargin) : null;
      const minimum = picked?.rule.minMargin == null ? null : Number(picked.rule.minMargin);
      const status = D(item.price).lt(item.unitCost) ? 'BELOW_COST' : minimum !== null && margin < minimum ? 'BELOW_MINIMUM'
        : target !== null && margin < target - 0.0005 ? 'UNDER_TARGET' : null;
      if (!status) continue;
      const suggestion = picked ? suggestPrice(item.unitCost, picked.rule.targetMargin, picked.rule.rounding as Rounding) : null;
      rows.push({ productId: product.id, sellingUnitId: item.sellingUnitId, name: item.name, sku: product.sku, price: Number(item.price),
        unitCost: Number(item.unitCost.toDecimalPlaces(4)), costBasis: basis.basis, margin: metrics.margin, targetMargin: target, minMargin: minimum,
        ruleSource: picked?.source ?? null, suggestedPrice: suggestion?.price ?? null, suggestedMargin: suggestion?.margin ?? null,
        sellingUnitVersion: item.version, status });
    }
  }
  const rank = { BELOW_COST: 0, BELOW_MINIMUM: 1, UNDER_TARGET: 2 } as const;
  return rows.sort((a, b) => rank[a.status as keyof typeof rank] - rank[b.status as keyof typeof rank] || (a.margin ?? -1) - (b.margin ?? -1));
}
