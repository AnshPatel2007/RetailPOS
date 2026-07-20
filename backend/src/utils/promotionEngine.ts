/**
 * Pure promotion evaluation engine.
 *
 * IMPORTANT: this module is duplicated at frontend/src/lib/promotionEngine.ts so the
 * cart preview matches the server-authoritative totals exactly. Keep both copies
 * identical (dependency-free, deterministic float math) when editing either one.
 *
 * Semantics:
 * - Units are never shared between promotions (no stacking). Higher `priority` wins,
 *   ties broken by id for determinism.
 * - QUANTITY_PRICE: every complete group of `buyQuantity` eligible units sells for
 *   `bundlePrice` total. Highest-priced units group first.
 * - BOGO: per group of `buyQuantity + getQuantity` units (highest-priced first), the
 *   cheapest `getQuantity` units in the group get `percentOff`% off (default 100).
 * - PERCENT_OFF / AMOUNT_OFF: applies to every eligible unit.
 * - Eligibility: product listed in `productIds` OR its category in `categoryIds`.
 *   A promotion targeting nothing matches nothing.
 */

export type PromotionRuleType = 'QUANTITY_PRICE' | 'BOGO' | 'PERCENT_OFF' | 'AMOUNT_OFF';

export interface PromotionRule {
  id: string;
  name: string;
  type: PromotionRuleType;
  buyQuantity?: number | null;
  getQuantity?: number | null;
  bundlePrice?: number | null;
  percentOff?: number | null;
  amountOff?: number | null;
  productIds: string[];
  categoryIds: string[];
  priority: number;
}

export interface PromotionSchedule {
  isActive: boolean;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  daysOfWeek?: number[] | null;
  startTime?: string | null; // "HH:MM"
  endTime?: string | null;
}

export interface PromoLineInput {
  /** Stable cart-line identifier the caller uses to read results back */
  key: string;
  productId: string;
  categoryId: string | null;
  unitPrice: number;
  quantity: number;
}

export interface PromoLineResult {
  discount: number; // rounded to cents, clamped to the line total
  promotionId: string;
  promotionName: string;
}

/** Hard cap on expanded units so a bogus quantity can't stall the request */
const MAX_UNITS = 10000;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Schedule check. `now` defaults to the current time; pass the store-local time if
 * the server runs in a different timezone than the store.
 */
export function isPromotionActiveNow(promo: PromotionSchedule, now: Date = new Date()): boolean {
  if (!promo.isActive) return false;
  if (promo.startsAt && now < new Date(promo.startsAt)) return false;
  if (promo.endsAt && now > new Date(promo.endsAt)) return false;
  if (promo.daysOfWeek && promo.daysOfWeek.length > 0 && !promo.daysOfWeek.includes(now.getDay())) {
    return false;
  }
  if (promo.startTime && promo.endTime) {
    const toMinutes = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const t = now.getHours() * 60 + now.getMinutes();
    const start = toMinutes(promo.startTime);
    const end = toMinutes(promo.endTime);
    if (start <= end) {
      if (t < start || t > end) return false;
    } else {
      // Overnight window (e.g. 22:00–02:00)
      if (t < start && t > end) return false;
    }
  }
  return true;
}

interface Unit {
  lineKey: string;
  productId: string;
  price: number;
  used: boolean;
}

/**
 * Evaluate promotions against cart lines. Returns a map of line key → applied
 * discount. Lines touched by more than one promotion sum their discounts and are
 * labeled with the promotion that contributed the most.
 */
export function applyPromotions(
  lines: PromoLineInput[],
  promotions: PromotionRule[]
): Map<string, PromoLineResult> {
  const results = new Map<string, PromoLineResult>();
  if (lines.length === 0 || promotions.length === 0) return results;

  // Expand lines into single units
  const units: Unit[] = [];
  for (const line of lines) {
    if (line.unitPrice <= 0 || line.quantity <= 0) continue;
    for (let i = 0; i < line.quantity && units.length < MAX_UNITS; i++) {
      units.push({ lineKey: line.key, productId: line.productId, price: line.unitPrice, used: false });
    }
  }

  const lineByKey = new Map(lines.map((l) => [l.key, l]));
  // Per line, per promotion: accumulated raw (unrounded) discount
  const perLine = new Map<string, Map<string, { name: string; discount: number }>>();
  const addDiscount = (lineKey: string, promo: PromotionRule, amount: number) => {
    if (amount <= 0) return;
    let byPromo = perLine.get(lineKey);
    if (!byPromo) {
      byPromo = new Map();
      perLine.set(lineKey, byPromo);
    }
    const entry = byPromo.get(promo.id) || { name: promo.name, discount: 0 };
    entry.discount += amount;
    byPromo.set(promo.id, entry);
  };

  const sorted = [...promotions].sort(
    (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );

  for (const promo of sorted) {
    if (promo.productIds.length === 0 && promo.categoryIds.length === 0) continue;

    const matches = (u: Unit) => {
      const line = lineByKey.get(u.lineKey)!;
      return (
        promo.productIds.includes(line.productId) ||
        (line.categoryId !== null && promo.categoryIds.includes(line.categoryId))
      );
    };

    // Highest-priced eligible units first. Ties break on productId — NOT the line
    // key — because the frontend and backend key lines differently and BOGO "free"
    // slot assignment must land on the same line on both sides.
    const eligible = units
      .filter((u) => !u.used && matches(u))
      .sort((a, b) => b.price - a.price || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));

    switch (promo.type) {
      case 'QUANTITY_PRICE': {
        const n = promo.buyQuantity ?? 0;
        const bundle = promo.bundlePrice ?? 0;
        if (n < 1 || bundle < 0) break;
        for (let g = 0; g + n <= eligible.length; g += n) {
          const group = eligible.slice(g, g + n);
          const sum = group.reduce((s, u) => s + u.price, 0);
          const discount = sum - bundle;
          // Groups are sorted by price desc, so once a group has no benefit none will
          if (discount <= 0.004) break;
          for (const u of group) {
            addDiscount(u.lineKey, promo, discount * (u.price / sum));
            u.used = true;
          }
        }
        break;
      }
      case 'BOGO': {
        const buy = promo.buyQuantity ?? 0;
        const free = promo.getQuantity ?? 0;
        const pct = promo.percentOff ?? 100;
        if (buy < 1 || free < 1 || pct <= 0) break;
        const size = buy + free;
        for (let g = 0; g + size <= eligible.length; g += size) {
          const group = eligible.slice(g, g + size);
          // Group is price-desc, so the last `free` units are the cheapest
          for (let i = 0; i < group.length; i++) {
            const u = group[i];
            if (i >= buy) addDiscount(u.lineKey, promo, u.price * (pct / 100));
            u.used = true;
          }
        }
        break;
      }
      case 'PERCENT_OFF': {
        const pct = promo.percentOff ?? 0;
        if (pct <= 0) break;
        for (const u of eligible) {
          addDiscount(u.lineKey, promo, u.price * (pct / 100));
          u.used = true;
        }
        break;
      }
      case 'AMOUNT_OFF': {
        const off = promo.amountOff ?? 0;
        if (off <= 0) break;
        for (const u of eligible) {
          addDiscount(u.lineKey, promo, Math.min(off, u.price));
          u.used = true;
        }
        break;
      }
    }
  }

  // Collapse per-promo buckets: sum discounts, label with the biggest contributor
  for (const [lineKey, byPromo] of perLine) {
    const line = lineByKey.get(lineKey)!;
    let total = 0;
    let topId = '';
    let topName = '';
    let topAmount = -1;
    for (const [promoId, entry] of byPromo) {
      total += entry.discount;
      if (entry.discount > topAmount) {
        topAmount = entry.discount;
        topId = promoId;
        topName = entry.name;
      }
    }
    const clamped = Math.min(round2(total), round2(line.unitPrice * line.quantity));
    if (clamped <= 0) continue;
    results.set(lineKey, { discount: clamped, promotionId: topId, promotionName: topName });
  }

  return results;
}
