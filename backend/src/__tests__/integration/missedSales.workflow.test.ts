import { randomUUID } from 'crypto';
import { prisma, seedTestData, TestData } from './setup';
import { missedSales } from '../../services/missedSales.service';
import { emptyShelves, AttentionContext } from '../../services/attention.service';
import { reportCalendar } from '../../services/reportDates.service';

describe('Missed sales from empty shelves (estimate)', () => {
  let data: TestData;
  const zone = 'America/Chicago';
  // Monday Nov 16, 2026, noon in Chicago: "last week" is Mon Nov 9 to Sun Nov 15.
  const monday = new Date('2026-11-16T18:00:00Z');
  const clock = reportCalendar(zone, monday);
  /** A store-local time on a date: local(2026, 11, 10, 9.5) is 9:30 AM on Nov 10. */
  const local = (year: number, month: number, day: number, hours: number) => new Date(clock.midnight(year, month, day).getTime() + hours * 3600000);
  beforeEach(async () => {
    data = await seedTestData();
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: zone } });
  });
  const product = (name: string, price: number) => prisma.product.create({ data: { name, sku: name.toUpperCase(), price, cost: 1, stockQuantity: 10, locationId: data.location.id } });
  const sell = (at: Date, lines: { id: string; name: string }[]) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), userId: data.cashierUser.id, locationId: data.location.id, createdAt: at, pricingVersion: 1,
    paymentMethod: 'CASH', subtotal: lines.length, tax: 0, total: lines.length, amountPaid: lines.length,
    items: { create: lines.map(line => ({ productId: line.id, productName: line.name, sku: line.name.toUpperCase(), quantity: 1, price: 1, total: 1, tax: 0, unitCost: 1 })) },
  } });
  const stock = (productId: string, at: Date, newQty: number) => prisma.inventoryLog.create({ data: { productId, locationId: data.location.id, type: newQty > 0 ? 'PURCHASE' : 'SALE',
    quantity: newQty > 0 ? newQty : -1, previousQty: newQty > 0 ? 0 : 1, newQty, createdAt: at } });

  it('estimates selling hours lost while items were out, capped at three days, and leaves out unreliable cases', async () => {
    const ice = await product('Ice', 10), bread = await product('Bread', 5), milk = await product('Milk', 4), gum = await product('Gum', 2), fresh = await product('Fresh', 10);
    // The 28 days before the week (Oct 12 to Nov 8): the store sells at 10:30 and 3:30 every day.
    // Ice, bread and milk sell two a day; gum only 20 in all (a slow seller); Fresh started Oct 25 (too little history).
    for (let day = 0; day < 28; day++) {
      const date = new Date(Date.UTC(2026, 9, 12 + day));
      const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
      const lines = [ice, bread, milk, ...(day >= 13 ? [fresh] : [])];
      await sell(local(y, m, d, 10.5), [...lines, ...(day < 20 ? [gum] : [])]);
      await sell(local(y, m, d, 15.5), lines);
    }
    // Ice: out from Tue 9:30 AM to Wed noon. Selling hours lost: Tue 10-11, Tue 3-4, Wed 10-11 = 3 hours = 3 units = $30.
    await stock(ice.id, local(2026, 11, 10, 9.5), 0);
    await stock(ice.id, local(2026, 11, 11, 12), 24);
    // Bread: out since Sunday night before the week, never restocked: 14 selling hours, capped at three days (6 units) = $30.
    await stock(bread.id, local(2026, 11, 8, 20), 0);
    // Milk "ran out" but sold during the stretch: the record was wrong, not the shelf.
    await stock(milk.id, local(2026, 11, 12, 9), 0);
    await sell(local(2026, 11, 12, 15.5), [milk]);
    await stock(milk.id, local(2026, 11, 13, 9), 12);
    // Slow and new items are left out even though they ran out.
    for (const item of [gum, fresh]) { await stock(item.id, local(2026, 11, 10, 8), 0); await stock(item.id, local(2026, 11, 11, 8), 10); }

    const result = await missedSales(data.location.id, monday);
    expect(result.period).toEqual({ start: local(2026, 11, 9, 0), end: local(2026, 11, 16, 0), timezone: zone });
    expect(result.items).toEqual([
      { productId: bread.id, name: 'Bread', hoursOut: 14, missedUnits: 6, value: 30 },
      { productId: ice.id, name: 'Ice', hoursOut: 3, missedUnits: 3, value: 30 },
    ]);
    expect(result.total).toBe(60);

    const context = { locationId: data.location.id, now: monday, calendar: clock } as AttentionContext;
    expect(await emptyShelves(context)).toEqual({ key: 'empty-shelves', severity: 'medium', amount: 60, count: 2, href: '/inventory/purchasing/suggestions',
      sentence: 'Empty shelves cost about $60 last week: Bread about $30 and Ice about $30.' });
    // Weekly: only on Mondays.
    const tuesday = new Date(monday.getTime() + 86400000);
    expect(await emptyShelves({ ...context, now: tuesday, calendar: reportCalendar(zone, tuesday) })).toBeNull();
  });

  it('says nothing under $20, or when there is no sales history to go on', async () => {
    expect(await missedSales(data.location.id, monday)).toMatchObject({ total: 0, items: [] });
    const ice = await product('Ice', 1);
    for (let day = 0; day < 28; day++) {
      const date = new Date(Date.UTC(2026, 9, 12 + day));
      await sell(local(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 10.5), [ice]);
    }
    await stock(ice.id, local(2026, 11, 10, 9), 0);
    const context = { locationId: data.location.id, now: monday, calendar: clock } as AttentionContext;
    expect((await missedSales(data.location.id, monday)).total).toBeGreaterThan(0);
    expect(await emptyShelves(context)).toBeNull();
  });
});
