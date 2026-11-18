import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getSalesForecastData } from '../../services/salesForecast.service';
import { getReportCalendar } from '../../services/reportDates.service';

describe('Forecast uses complete store dates and honest estimates', () => {
  let data: TestData;
  const now = new Date('2026-11-01T18:00:00Z');
  beforeEach(async () => { data = await seedTestData(); await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } }); });
  const sale = (createdAt: Date, locationId: string | null = data.location.id) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), userId: data.adminUser.id, locationId, createdAt, total: 22, subtotal: 20, tax: 2, amountPaid: 22, paymentMethod: 'CASH', pricingVersion: 1,
    items: { create: { productId: data.product.id, productName: 'Original', sku: data.product.sku, quantity: 2, price: 10, total: 22, tax: 2, unitCost: 4 } },
  }, include: { items: true } });
  const history = async (step = 1) => {
    const calendar = await getReportCalendar({ locationId: data.location.id }, now);
    const sales = [];
    for (let day = -28; day < 0; day += step) sales.push(await sale(new Date(calendar.day(day).getTime() + 3600000)));
    return sales;
  };

  it('does not invent forecasts for an empty store or insufficient trading history', async () => {
    const empty = await getSalesForecastData({ locationId: data.location.id }, 7, now);
    expect(empty).toMatchObject({ status: 'UNAVAILABLE', forecast: [], summary: { totalForecastRevenue: null, expectedGrowth: null }, historicalPeriod: { days: 0 } });
    await sale(new Date('2026-10-01T12:00:00Z'));
    const sparse = await getSalesForecastData({ locationId: data.location.id }, 7, now);
    expect(sparse.status).toBe('UNAVAILABLE'); expect(sparse.historicalPeriod.dataPoints).toBe(1);
  });

  it('counts zero-sales dates and labels observed ranges without implying statistical confidence', async () => {
    await history(2);
    const report = await getSalesForecastData({ locationId: data.location.id }, 28, now);
    expect(report).toMatchObject({ status: 'ESTIMATE', summary: { totalForecastRevenue: 308, avgDailyForecast: 11, historicalAvgDaily: 11, expectedGrowth: 0 }, historicalPeriod: { days: 28, dataPoints: 14 } });
    expect(report.forecast).toHaveLength(28);
    expect(report.forecast.every(row => row.confidenceLow === 0 && row.confidenceHigh === 22)).toBe(true);
    expect(report.basis).toContain('not confidence intervals');
    expect(report.forecast[0].date).toBe('2026-11-02');
  });

  it('subtracts later returns on the return date and keeps signed negative days', async () => {
    const originals = await history();
    for (const original of originals.slice(0, 2)) await prisma.refund.create({ data: { saleId: original.id, createdAt: new Date('2026-10-31T12:00:00Z'), amount: 22, taxAmount: 2,
      reason: 'Historic adjustment fixture', refundedBy: data.adminUser.id, method: 'CASH', pointsRestored: 0 } });
    const report = await getSalesForecastData({ locationId: data.location.id }, 28, now);
    expect(report.summary.totalForecastRevenue).toBe(572);
    expect(report.forecast.some(row => row.confidenceLow === -22)).toBe(true);
  });

  it('excludes the current partial day, future dates, partner stores and unassigned records', async () => {
    await history();
    const before = await getSalesForecastData({ locationId: data.location.id }, 7, now);
    await sale(now); await sale(new Date('2027-01-01T00:00:00Z')); await sale(new Date('2026-10-20T12:00:00Z'), null);
    const partner = await prisma.location.create({ data: { name: 'Partner', address: 'Other', city: 'Other', state: 'TS', zipCode: '12345', phone: '555', email: 'partner@example.test' } });
    await sale(new Date('2020-01-01T00:00:00Z'), partner.id);
    expect(await getSalesForecastData({ locationId: data.location.id }, 7, now)).toEqual(before);
  });

  it('uses local midnight and limits history to ninety complete calendar dates', async () => {
    await history(); const calendar = await getReportCalendar({ locationId: data.location.id }, now);
    await sale(new Date(calendar.day(-90).getTime() - 1));
    await sale(new Date(calendar.day().getTime() - 1));
    const report = await getSalesForecastData({ locationId: data.location.id }, 7, now);
    expect(report.historicalPeriod.days).toBe(90); expect(report.historicalPeriod.end).toBe('2026-10-31');
    expect(report.summary.historicalAvgDaily).toBe(7.09);
  });

  it('marks forecasts unavailable when earlier undated voids make history incomplete', async () => {
    const originals = await history(); await prisma.sale.update({ where: { id: originals[0].id }, data: { status: 'VOIDED' } });
    expect(await getSalesForecastData({ locationId: data.location.id }, 7, now)).toMatchObject({ status: 'UNAVAILABLE', forecast: [], unavailableReason: expect.stringContaining('Older voids') });
  });

  it('bounds requests and enforces role and store access at the API', async () => {
    const token = await createTestToken(data.adminUser.id, 'ADMIN');
    for (const days of ['0', '-1', '61', '7.5', '7x', 'Infinity']) await request(app).get('/api/analytics/forecast?forecastDays=' + days).set('Authorization', 'Bearer ' + token).expect(400);
    await request(app).get('/api/analytics/forecast?locationId=other').set('Authorization', 'Bearer ' + token).expect(403);
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await request(app).get('/api/analytics/forecast').set('Authorization', 'Bearer ' + cashier).expect(403);
  });
});
