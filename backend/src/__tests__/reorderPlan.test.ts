import { deliverySchedule, planReorder, ReorderLink, ReorderProduct, StoreDay } from '../services/reorderPlan';

const day = (date: string): StoreDay => ({ date, weekday: new Date(date + 'T12:00:00Z').getUTCDay() });
const monday = day('2026-11-16');
const coke: ReorderLink = { supplierId: 'coke', supplierName: 'Coke', leadTimeDays: 1, deliveryDays: [2, 5], cost: 0.5, packSize: 1, packCost: null, minOrder: null };
const product = (overrides: Partial<ReorderProduct>): ReorderProduct => ({ productId: overrides.name || 'p', name: 'p', sku: 'P', cost: 0.5,
  stockQuantity: 5, lowStockAlert: 0, unitsSold: 30, onOrder: 0, link: coke, ...overrides });
const items = (plan: ReturnType<typeof planReorder>, supplierId: string | null = 'coke') => plan.suppliers.find(group => group.supplierId === supplierId)?.items || [];

describe('delivery schedule', () => {
  it('finds the first delivery at least the lead time away, and the one after it', () => {
    expect(monday.weekday).toBe(1);
    expect(deliverySchedule(monday, [2, 5], 1)).toEqual({ daysToNext: 1, daysToFollowing: 4, nextDelivery: '2026-11-17', followingDelivery: '2026-11-20' });
    expect(deliverySchedule(monday, [2, 5], 2)).toEqual({ daysToNext: 4, daysToFollowing: 8, nextDelivery: '2026-11-20', followingDelivery: '2026-11-24' });
    // No lead time recorded: an order placed today arrives tomorrow at the earliest.
    expect(deliverySchedule(monday, [5, 2, 2], null)?.daysToNext).toBe(1);
  });

  it('never delivers today, and a weekly supplier comes back a week later', () => {
    const tuesday = day('2026-11-17');
    expect(deliverySchedule(tuesday, [2], 0)).toMatchObject({ daysToNext: 7, daysToFollowing: 14, nextDelivery: '2026-11-24', followingDelivery: '2026-12-01' });
    expect(deliverySchedule(tuesday, [], 1)).toBeNull();
    expect(deliverySchedule(tuesday, [9, -1], 1)).toBeNull();
  });
});

describe('planReorder', () => {
  it('without delivery days keeps two weeks of cover for items under a week', () => {
    const plan = planReorder([product({ name: 'Water', link: { ...coke, deliveryDays: [] } }), product({ name: 'Plenty', stockQuantity: 20, link: { ...coke, deliveryDays: [] } })], monday);
    const group = plan.suppliers[0];
    expect(group).toMatchObject({ basis: 'DEFAULT', nextDelivery: null, followingDelivery: null, coverDays: 14 });
    expect(group.items).toEqual([expect.objectContaining({ name: 'Water', velocityPerDay: 1, daysOfCover: 5, suggestedQty: 9, urgent: true, runsOutBeforeFollowing: false })]);
    expect(plan).toMatchObject({ today: '2026-11-16', velocityWindowDays: 30, coverTargetDays: 14 });
  });

  it('with delivery days plans to the following delivery plus two days of safety', () => {
    // Tuesday and Friday deliveries, ordered Monday: arrives Tuesday, must last to Friday + 2 days = 6 days.
    const plan = planReorder([
      product({ name: 'Five' }),
      product({ name: 'Three', stockQuantity: 3 }),
      product({ name: 'Empty', stockQuantity: 0 }),
      product({ name: 'Six', stockQuantity: 6 }),
    ], monday);
    const group = plan.suppliers[0];
    expect(group).toMatchObject({ basis: 'DELIVERY_DAYS', nextDelivery: '2026-11-17', followingDelivery: '2026-11-20', coverDays: 6, deliveryDays: [2, 5] });
    expect(group.items.map(item => [item.name, item.suggestedQty, item.urgent, item.runsOutBeforeFollowing])).toEqual([
      ['Empty', 6, true, true], ['Three', 3, false, true], ['Five', 1, false, false]]);
  });

  it('is urgent when what is on hand runs out before the next delivery arrives', () => {
    const later = { ...coke, leadTimeDays: 2 }; // next delivery Friday, 4 days away; following Tuesday, 8 days
    expect(items(planReorder([product({ name: 'Three', stockQuantity: 3, link: later })], monday))[0]).toMatchObject({ urgent: true, suggestedQty: 7 });
  });

  it('counts stock already on order, and rounds up to cases and minimum orders', () => {
    expect(items(planReorder([product({ name: 'Ordered', stockQuantity: 2, onOrder: 10 })], monday))).toEqual([]);
    const cased = { ...coke, deliveryDays: [], packSize: 24, packCost: 12, minOrder: 48 };
    const [item] = items(planReorder([product({ name: 'Cans', stockQuantity: 5, unitsSold: 90, link: cased })], monday));
    // Three a day for 14 days is 42, less 5 on hand = 37, at least the minimum 48, in cases of 24: 48.
    expect(item).toMatchObject({ suggestedQty: 48, packSize: 24, packCost: 12 });
    expect(planReorder([product({ name: 'Cans', stockQuantity: 5, unitsSold: 90, link: cased })], monday).suppliers[0].estimatedTotal).toBe(24);
  });

  it('refills items at their low-stock level even without recent sales, and lists unlinked items last', () => {
    const plan = planReorder([
      product({ name: 'Unlinked', unitsSold: 0, stockQuantity: 1, lowStockAlert: 4, link: null }),
      product({ name: 'Slow', unitsSold: 0, stockQuantity: 4, lowStockAlert: 10 }),
      product({ name: 'Fine', unitsSold: 0, stockQuantity: 40, lowStockAlert: 10, link: { ...coke, supplierId: 'pepsi', supplierName: 'Pepsi' } }),
    ], monday);
    expect(plan.suppliers.map(group => group.supplierName)).toEqual(['Coke', 'No supplier linked']);
    expect(items(plan)[0]).toMatchObject({ name: 'Slow', suggestedQty: 16, daysOfCover: null, urgent: false });
    expect(items(plan, null)[0]).toMatchObject({ name: 'Unlinked', suggestedQty: 7 });
  });
});
