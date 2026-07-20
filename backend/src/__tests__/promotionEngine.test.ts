/**
 * Promotion Engine Unit Tests
 *
 * Pure-function tests for applyPromotions and isPromotionActiveNow — the same
 * engine runs in the frontend cart preview and the backend createSale pricing.
 */

import {
  applyPromotions,
  isPromotionActiveNow,
  PromotionRule,
  PromoLineInput,
} from '../utils/promotionEngine';

const line = (
  key: string,
  unitPrice: number,
  quantity: number,
  categoryId: string | null = null
): PromoLineInput => ({ key, productId: key, categoryId, unitPrice, quantity });

const promo = (overrides: Partial<PromotionRule>): PromotionRule => ({
  id: 'promo-1',
  name: 'Test Promo',
  type: 'PERCENT_OFF',
  buyQuantity: null,
  getQuantity: null,
  bundlePrice: null,
  percentOff: null,
  amountOff: null,
  productIds: [],
  categoryIds: [],
  priority: 0,
  ...overrides,
});

describe('applyPromotions', () => {
  describe('QUANTITY_PRICE (N for $X)', () => {
    const twoForSix = promo({
      type: 'QUANTITY_PRICE',
      buyQuantity: 2,
      bundlePrice: 6,
      productIds: ['soda'],
    });

    it('discounts a complete bundle', () => {
      // 2 × $4.00 = $8.00 → bundle $6.00 → save $2.00
      const results = applyPromotions([line('soda', 4, 2)], [twoForSix]);
      expect(results.get('soda')!.discount).toBe(2);
      expect(results.get('soda')!.promotionId).toBe('promo-1');
    });

    it('leaves the odd unit at full price', () => {
      // 3 units → one bundle discounted, third unit full price
      const results = applyPromotions([line('soda', 4, 3)], [twoForSix]);
      expect(results.get('soda')!.discount).toBe(2);
    });

    it('applies to multiple complete bundles', () => {
      const results = applyPromotions([line('soda', 4, 4)], [twoForSix]);
      expect(results.get('soda')!.discount).toBe(4);
    });

    it('mixes and matches across products, splitting the discount proportionally', () => {
      const mix = promo({
        type: 'QUANTITY_PRICE',
        buyQuantity: 2,
        bundlePrice: 6,
        productIds: ['soda', 'energy'],
      });
      // $4 + $4 = $8 → save $2, split evenly across the two lines
      const results = applyPromotions([line('soda', 4, 1), line('energy', 4, 1)], [mix]);
      expect(results.get('soda')!.discount).toBe(1);
      expect(results.get('energy')!.discount).toBe(1);
    });

    it('does not apply when the bundle price exceeds the shelf total', () => {
      // 2 × $2.50 = $5.00 < $6.00 bundle — no "discount" that raises the price
      const results = applyPromotions([line('soda', 2.5, 2)], [twoForSix]);
      expect(results.size).toBe(0);
    });
  });

  describe('BOGO', () => {
    it('makes the cheapest unit free on buy-1-get-1', () => {
      const bogo = promo({
        type: 'BOGO',
        buyQuantity: 1,
        getQuantity: 1,
        percentOff: 100,
        productIds: ['chips', 'candy'],
      });
      // $3.00 chips paid, $2.00 candy free
      const results = applyPromotions([line('chips', 3, 1), line('candy', 2, 1)], [bogo]);
      expect(results.get('candy')!.discount).toBe(2);
      expect(results.has('chips')).toBe(false);
    });

    it('supports partial percent off the free units', () => {
      const bogoHalf = promo({
        type: 'BOGO',
        buyQuantity: 1,
        getQuantity: 1,
        percentOff: 50,
        productIds: ['chips'],
      });
      // Second unit half price: $4 × 50% = $2
      const results = applyPromotions([line('chips', 4, 2)], [bogoHalf]);
      expect(results.get('chips')!.discount).toBe(2);
    });

    it('requires the full group before discounting', () => {
      const bogo = promo({
        type: 'BOGO',
        buyQuantity: 2,
        getQuantity: 1,
        percentOff: 100,
        productIds: ['chips'],
      });
      // Only 2 units — buy-2-get-1 needs 3
      const results = applyPromotions([line('chips', 4, 2)], [bogo]);
      expect(results.size).toBe(0);
    });
  });

  describe('PERCENT_OFF / AMOUNT_OFF', () => {
    it('applies percent off every eligible unit, matched by category', () => {
      const sale = promo({ type: 'PERCENT_OFF', percentOff: 20, categoryIds: ['snacks'] });
      const results = applyPromotions(
        [line('chips', 5, 2, 'snacks'), line('milk', 4, 1, 'dairy')],
        [sale]
      );
      expect(results.get('chips')!.discount).toBe(2); // 20% of $10
      expect(results.has('milk')).toBe(false);
    });

    it('clamps amount off at the unit price', () => {
      const off = promo({ type: 'AMOUNT_OFF', amountOff: 5, productIds: ['gum'] });
      const results = applyPromotions([line('gum', 1.5, 2)], [off]);
      expect(results.get('gum')!.discount).toBe(3); // $1.50 each, not $5
    });
  });

  describe('stacking and priority', () => {
    it('never applies two promotions to the same units', () => {
      const twenty = promo({
        id: 'a', name: 'A', type: 'PERCENT_OFF', percentOff: 20, productIds: ['soda'], priority: 10,
      });
      const fifty = promo({
        id: 'b', name: 'B', type: 'PERCENT_OFF', percentOff: 50, productIds: ['soda'], priority: 0,
      });
      // Higher priority (20%) consumes the units; 50% finds nothing left
      const results = applyPromotions([line('soda', 10, 1)], [twenty, fifty]);
      expect(results.get('soda')!.discount).toBe(2);
      expect(results.get('soda')!.promotionId).toBe('a');
    });

    it('matches nothing when the promotion targets nothing', () => {
      const untargeted = promo({ type: 'PERCENT_OFF', percentOff: 50 });
      const results = applyPromotions([line('soda', 10, 1)], [untargeted]);
      expect(results.size).toBe(0);
    });

    it('caps the combined discount at the line total', () => {
      const off = promo({ type: 'AMOUNT_OFF', amountOff: 99, productIds: ['gum'] });
      const results = applyPromotions([line('gum', 2, 3)], [off]);
      expect(results.get('gum')!.discount).toBe(6);
    });
  });
});

describe('isPromotionActiveNow', () => {
  const base = { isActive: true };

  it('rejects inactive promotions', () => {
    expect(isPromotionActiveNow({ isActive: false })).toBe(false);
  });

  it('honors the date window', () => {
    const now = new Date('2026-07-15T12:00:00');
    expect(isPromotionActiveNow({ ...base, startsAt: '2026-07-01', endsAt: '2026-07-31' }, now)).toBe(true);
    expect(isPromotionActiveNow({ ...base, startsAt: '2026-08-01' }, now)).toBe(false);
    expect(isPromotionActiveNow({ ...base, endsAt: '2026-07-01' }, now)).toBe(false);
  });

  it('honors days of the week', () => {
    const wednesday = new Date('2026-07-15T12:00:00'); // July 15 2026 is a Wednesday
    expect(isPromotionActiveNow({ ...base, daysOfWeek: [3] }, wednesday)).toBe(true);
    expect(isPromotionActiveNow({ ...base, daysOfWeek: [0, 6] }, wednesday)).toBe(false);
    expect(isPromotionActiveNow({ ...base, daysOfWeek: [] }, wednesday)).toBe(true);
  });

  it('honors same-day time windows', () => {
    const noon = new Date('2026-07-15T12:00:00');
    expect(isPromotionActiveNow({ ...base, startTime: '11:00', endTime: '13:00' }, noon)).toBe(true);
    expect(isPromotionActiveNow({ ...base, startTime: '14:00', endTime: '17:00' }, noon)).toBe(false);
  });

  it('handles overnight windows crossing midnight', () => {
    const lateNight = new Date('2026-07-15T23:30:00');
    const earlyMorning = new Date('2026-07-15T01:30:00');
    const midday = new Date('2026-07-15T12:00:00');
    const overnight = { ...base, startTime: '22:00', endTime: '02:00' };
    expect(isPromotionActiveNow(overnight, lateNight)).toBe(true);
    expect(isPromotionActiveNow(overnight, earlyMorning)).toBe(true);
    expect(isPromotionActiveNow(overnight, midday)).toBe(false);
  });
});
