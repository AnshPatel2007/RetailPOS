import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialMetrics, getFinancialBreakdowns } from '../../services/financialMetrics.service';
import { reportCalendar } from '../../services/reportDates.service';
import { promises as fs } from 'fs';
import { processNextBackgroundJob } from '../../services/jobQueue.service';
import { executeBackgroundJob } from '../../services/backgroundWorker.service';
import { exportPath } from '../../services/queuedExport.service';
const { buildPlan, applyPlan } = require('../../../scripts/import-historical-ledger.cjs');

describe('Historical summaries retain facts without inventing receipts or costs', () => {
  let data: TestData, token: string, plan: ReturnType<typeof buildPlan>;
  const cal = reportCalendar('America/Chicago');
  const range = { gte: cal.midnight(2026, 1, 1), lt: cal.midnight(2026, 2, 1) };
  beforeEach(async () => {
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    plan = buildPlan({ sha256: 'a'.repeat(64), amountUnit: 'integer cents', blocks: [{
      store: 'Fixture', period: '2026-01', sourceTitle: 'Fixture January', issues: [], sidebar: [],
      days: [100, -50].map((lottery, i) => ({ date: `2026-01-0${i + 1}`, sourceLine: i + 3,
        valuesCents: { totalCollected: 11000, register1: 4000, register2: null, tax1: 1000, tax2: null, card: 7000, lottery } })),
      calculatedCents: { totalCollected: 22000, tax: 2000 },
      sourceMonthlyInputsCents: { expenses: 3000, gamingAtm: 500, lotteryCommission: 250 },
      comparisonOnlyCents: { grossProfit: 999999, netProfit: 888888, taxProfitUnclassified: 77777 },
    }] }, { Fixture: { id: data.location.id, userId: data.adminUser.id, timezone: 'America/Chicago', code: 'TEST' } });
  });

  it('posts atomically, retries without duplication and leaves stock, customer spending and drawers intact', async () => {
    const before = await prisma.product.findUnique({ where: { id: data.product.id } });
    const drawers = await prisma.drawerEntry.count(), logs = await prisma.inventoryLog.count();
    expect(await applyPlan(prisma, plan)).toEqual({ sales: 2, expenses: 1, income: 2, existing: 0 });
    expect(await applyPlan(prisma, plan)).toEqual({ sales: 0, expenses: 0, income: 0, existing: 5 });
    expect(await prisma.product.findUnique({ where: { id: data.product.id } })).toEqual(before);
    expect(await prisma.drawerEntry.count()).toBe(drawers); expect(await prisma.inventoryLog.count()).toBe(logs);
    expect(await prisma.saleItem.count()).toBe(0);
    expect(await prisma.expense.findFirst()).toMatchObject({ sourceType: 'MONTHLY_SUMMARY', status: 'APPROVED', paidDate: null });
    const altered = { ...plan, expenses: [...plan.expenses, { ...plan.expenses[0], id: 'will-rollback', expenseNumber: 'will-rollback' }], income: [{ ...plan.income[0], amount: '999.00' }] };
    await expect(applyPlan(prisma, altered)).rejects.toThrow();
    expect(await prisma.expense.findUnique({ where: { id: 'will-rollback' } })).toBeNull();
  });

  it('reconciles income and tender facts while keeping unknown counts, discounts and profit unavailable', async () => {
    await applyPlan(prisma, plan);
    const scope = { locationId: data.location.id };
    expect(await getFinancialMetrics(scope, range)).toMatchObject({ grossCollected: 220, taxCharged: 20, netSales: 200,
      historicalSummaries: 2, transactions: null, discounts: null, costOfGoodsSold: null, netProfit: null, expenses: 30, otherIncome: 7.5 });
    const rows = await getFinancialBreakdowns(scope, range, 'America/Chicago', range.gte);
    expect(rows.filter(r => r.kind === 'payment')).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'CARD', total: 140, count: null }), expect.objectContaining({ key: 'UNAVAILABLE', total: 80, count: null }),
    ]));
    expect(rows.filter(r => ['employee', 'hour'].includes(r.kind))).toEqual([]);
    expect(rows.filter(r => r.kind === 'day')).toHaveLength(2);
    const report = (await request(app).get('/api/reports/sales?startDate=2026-01-01&endDate=2026-01-31').set('Authorization', 'Bearer ' + token).expect(200)).body.data;
    expect(report.summary).toMatchObject({ totalSales: 220, totalTransactions: null, averageOrderValue: null, totalDiscount: null });
    expect(report.employeeBreakdown).toEqual({}); expect(report.sales.every((s: any) => s.sourceType === 'DAILY_SUMMARY')).toBe(true);
    expect(await getFinancialMetrics({ ...scope, userId: data.adminUser.id }, range)).toMatchObject({ grossCollected: 0, transactions: 0, otherIncome: 0 });
    expect(await getFinancialMetrics({ locationId: randomUUID() }, range)).toMatchObject({ grossCollected: 0, otherIncome: 0 });
    await prisma.sale.create({ data: { saleNumber: randomUUID(), userId: data.adminUser.id, locationId: data.location.id,
      createdAt: cal.midnight(2026, 1, 3), total: 11, subtotal: 10, tax: 1, amountPaid: 11, paymentMethod: 'CASH',
      items: { create: { productId: data.product.id, productName: 'Actual receipt', sku: data.product.sku, quantity: 1, price: 10, tax: 1, total: 11, unitCost: 4 } } } });
    expect(await getFinancialMetrics(scope, range)).toMatchObject({ grossCollected: 231, transactions: null, recordedReceiptCount: 1, netProfit: null });
  });

  it('preserves missing historical costs and returns recorded-only compatibility fields', async () => {
    await applyPlan(prisma, plan);
    const response = await request(app).get('/api/financial/reports/pnl?startDate=2026-01-01&endDate=2026-01-31')
      .set('Authorization', 'Bearer ' + token).expect(200);
    expect(response.body.data).toMatchObject({ costOfGoodsSold: null, netIncome: null, defaultCostView: 'recorded',
      scope: { locationId: data.location.id, storeName: data.location.name }, snapshotAt: expect.any(String),
      revenue: { netSales: 200, taxCollected: 20 },
      estimate: null });
    expect(response.body.data.operatingExpenses.byCategory.reduce((sum: number, row: { amount: number }) => sum + row.amount, 0)).toBe(response.body.data.operatingExpenses.total);
    const february = await request(app).get('/api/financial/reports/pnl?startDate=2026-02-01&endDate=2026-02-28')
      .set('Authorization', 'Bearer ' + token).expect(200);
    expect(february.body.data).toMatchObject({ defaultCostView: 'recorded', estimate: null });
    expect(await prisma.saleItem.count()).toBe(0); expect(await prisma.expense.count()).toBe(1);
    expect(await getFinancialMetrics({ locationId: data.location.id }, range)).toMatchObject({ costOfGoodsSold: null, grossProfit: null });
    await request(app).get('/api/financial/reports/pnl?locationId=' + randomUUID()).set('Authorization', 'Bearer ' + token).expect(403);
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await request(app).get('/api/financial/reports/pnl').set('Authorization', 'Bearer ' + cashier).expect(403);
  });

  it('exports monthly daily grids with original register facts, unknowns and separate expenses', async () => {
    await applyPlan(prisma, plan);
    const response = await request(app).get('/api/financial/reports/pnl?workbook=true&startDate=2026-01-01&endDate=2026-02-28')
      .set('Authorization', 'Bearer ' + token).expect(200);
    const months = response.body.data.workbook.months;
    expect(months).toHaveLength(2);
    expect(months[0]).toMatchObject({ month: '2026-01', store: { id: data.location.id }, metrics: { netSales: 200, expenses: 30, otherIncome: 7.5 },
      days: [{ date: '2026-01-01', sales: 110, register1: 40, tax1: 10, register2: null, tax2: null, card: 70, lotteryNet: 1, netSales: 100 },
        { date: '2026-01-02', sales: 110, register1: 40, tax1: 10, register2: null, tax2: null, card: 70, lotteryNet: -0.5, netSales: 100 }],
      expenses: [{ amount: 30, sourceType: 'MONTHLY_SUMMARY', description: 'Monthly operating expenses (source total; categories not supplied)' }],
      estimate: null });
    expect(months[0].income).toEqual(expect.arrayContaining([{ kind: 'GAMING_ATM', amount: 5 }, { kind: 'LOTTERY_COMMISSION', amount: 2.5 }]));
    expect(months[1]).toMatchObject({ month: '2026-02', days: [], expenses: [], income: [] });
    await request(app).get('/api/financial/reports/pnl?workbook=true&startDate=2024-01-01&endDate=2026-01-01')
      .set('Authorization', 'Bearer ' + token).expect(400);
    await request(app).get('/api/financial/reports/pnl?workbook=true&locationId=' + randomUUID()).set('Authorization', 'Bearer ' + token).expect(403);
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await request(app).get('/api/financial/reports/pnl?workbook=true').set('Authorization', 'Bearer ' + cashier).expect(403);
  });

  it('keeps return-period adjustments separate from sales and aggregates private payroll descriptions', async () => {
    const sale = await prisma.sale.create({ data: { saleNumber: randomUUID(), userId: data.adminUser.id, locationId: data.location.id,
      createdAt: cal.midnight(2025, 12, 31), total: 110, subtotal: 100, tax: 10, amountPaid: 110, paymentMethod: 'CARD',
      items: { create: { productId: data.product.id, productName: 'Receipt', sku: data.product.sku, quantity: 1, price: 100, tax: 10, total: 110, unitCost: 40 } } } });
    await prisma.refund.create({ data: { saleId: sale.id, amount: 11, taxAmount: 1, reason: 'Test return', refundedBy: data.adminUser.id, method: 'CARD', createdAt: cal.midnight(2026, 1, 2) } });
    await prisma.sale.create({ data: { saleNumber: randomUUID(), userId: data.adminUser.id, locationId: data.location.id,
      createdAt: cal.midnight(2026, 1, 3), total: 22, subtotal: 20, tax: 2, amountPaid: 22, paymentMethod: 'CARD',
      payments: { create: { paymentMethod: 'CARD', amount: 22 } } } });
    for (const amount of [3, 7]) await prisma.expense.create({ data: { expenseNumber: randomUUID(), locationId: data.location.id,
      category: 'PAYROLL', amount, description: 'Private employee pay detail', status: 'APPROVED', expenseDate: cal.midnight(2026, 1, 31), userId: data.adminUser.id } });
    const response = await request(app).get('/api/financial/reports/pnl?workbook=true&startDate=2026-01-01&endDate=2026-01-31')
      .set('Authorization', 'Bearer ' + token).expect(200);
    const month = response.body.data.workbook.months[0];
    expect(month.metrics).toMatchObject({ grossCollected: 22, refunds: 11, netTax: 1, netSales: 10, expenses: 10 });
    expect(month.days).toEqual([expect.objectContaining({ date: '2026-01-02', sales: 0, refunds: 11, tax: -1, netSales: -10, register1: null, card: 0 }),
      expect.objectContaining({ date: '2026-01-03', sales: 22, refunds: 0, tax: 2, netSales: 20, register1: null, card: 22 })]);
    expect(month.expenses).toHaveLength(1); expect(month.expenses[0]).toMatchObject({ description: 'Payroll', amount: 10 });
    expect(JSON.stringify(month)).not.toContain('Private employee');
  });

  it('keeps summary provenance and unspecified settlement consistent across direct, accounting and queued exports', async () => {
    await applyPlan(prisma, plan);
    const auth = (path: string) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + token);
    const dates = '?startDate=2026-01-01&endDate=2026-01-31';
    const direct = await auth('/reports/sales/export/csv' + dates).expect(200);
    expect(direct.text.match(/"DAILY_SUMMARY"/g)).toHaveLength(2);
    expect(direct.text).toContain('Card recorded; remainder unspecified');
    expect(direct.text).not.toContain('2026-01-01T06:00:00');
    const journal = (await auth('/financial/export/sales' + dates).expect(200)).body.data;
    expect(journal.totalRevenue).toBe(220);
    expect(journal.entries).toHaveLength(2);
    for (const entry of journal.entries) expect(entry).toMatchObject({ entry: 'DAILY_SUMMARY', description: 'Historical daily sales summary',
      debitAccount: 'Historical settlement not supplied', paymentMethod: 'Card recorded; remainder unspecified', amount: 110, taxAmount: 10 });
    for (const type of ['SALES_ACTIVITY', 'EXPENSES']) {
      const queued = await request(app).post('/api/jobs/exports').set('Authorization', 'Bearer ' + token)
        .send({ idempotencyKey: randomUUID(), type, startDate: '2026-01-01', endDate: '2026-01-31' }).expect(202);
      await processNextBackgroundJob(executeBackgroundJob, new Date(Date.now() + 10000));
      const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: queued.body.data.id } });
      expect(job.status).toBe('COMPLETE'); const result = job.result as any;
      try {
        const download = await auth('/jobs/' + job.id + '/download').expect(200);
        if (type === 'SALES_ACTIVITY') {
          expect(result).toMatchObject({ recordCount: 2, netCollected: 220 });
          const rows = download.text.trim().split('\r\n').slice(1).map(line => line.slice(1, -1).split('","'));
          expect(rows).toHaveLength(2);
          rows.forEach((row, i) => {
            expect(row[0]).toBe('DAILY_SUMMARY'); expect(row[3]).toBe(''); expect(row[4]).toBe(`2026-01-0${i + 1}`);
            expect(row[6]).toBe('Card recorded; remainder unspecified'); expect(row[9]).toBe('Not supplied (daily summary)');
          });
        } else {
          expect(result.recordCount).toBe(1); expect(download.text).toContain('"MONTHLY_SUMMARY"');
          expect(download.text).toContain('Month-end recognition; transaction and payment dates not supplied');
          expect(download.text).toContain('"APPROVED","30"');
        }
        expect(download.text).not.toContain('test-admin');
      } finally { await fs.rm(exportPath(job.id, result.artifactKey), { force: true }); }
    }
  });

  it('rejects receipt reversals and reports lottery net separately from commission income', async () => {
    await applyPlan(prisma, plan);
    for (const action of ['void', 'refund']) {
      const response = await request(app).post(`/api/sales/${plan.sales[0].id}/${action}`).set('Authorization', 'Bearer ' + token)
        .send({ reason: 'Cannot reverse a summary', amount: 110, idempotencyKey: randomUUID() }).expect(409);
      expect(JSON.stringify(response.body)).toContain('Historical daily summaries');
    }
    const lottery = (await request(app).get('/api/lottery/reports/daily-summary?startDate=2026-01-01&endDate=2026-01-31').set('Authorization', 'Bearer ' + token).expect(200)).body.data;
    expect(lottery).toMatchObject({ historicalDays: 2, historicalNet: 0.5, totalNetAmount: 0.5 });
    expect(lottery.historicalNetDaily.map((r: any) => r.netAmount)).toEqual([1, -0.5]);
    const singleDay = (await request(app).get('/api/lottery/reports/daily-summary?startDate=2026-01-01&endDate=2026-01-01').set('Authorization', 'Bearer ' + token).expect(200)).body.data;
    expect(singleDay).toMatchObject({ historicalDays: 1, historicalNet: 1 });
    await expect(prisma.sale.update({ where: { id: plan.sales[1].id }, data: { sourceData: { ...plan.sales[1].sourceData, lotteryNetCents: null } } })).rejects.toThrow('Booked sale facts are immutable');
    await prisma.sale.create({ data: { ...plan.sales[1], id: randomUUID(), saleNumber: randomUUID(), idempotencyKey: randomUUID(),
      createdAt: cal.midnight(2026, 1, 3), sourceData: { ...plan.sales[1].sourceData, businessDate: '2026-01-03', lotteryNetCents: null } } });
    const missing = (await request(app).get('/api/lottery/reports/daily-summary?startDate=2026-01-01&endDate=2026-01-31').set('Authorization', 'Bearer ' + token).expect(200)).body.data;
    expect(missing).toMatchObject({ historicalDays: 3, missingNetDays: 1, historicalNet: 0.5, totalNetAmount: null });
    await request(app).get('/api/lottery/reports/daily-summary?locationId=' + randomUUID()).set('Authorization', 'Bearer ' + token).expect(403);
    expect(await prisma.refund.count()).toBe(0); expect(await prisma.saleVoid.count()).toBe(0);
  });
});
