import request from 'supertest';
import { randomUUID } from 'crypto';
import { ExpenseCategory, ExpenseStatus } from '@prisma/client';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialMetrics } from '../../services/financialMetrics.service';
import { getAdminDashboard } from '../../services/adminDashboard.service';

describe('Inventory acquisition versus operating expense accounting', () => {
  let data: TestData, token: string;
  const get = (path: string, auth = token) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + auth);
  const expense = (category: ExpenseCategory, amount: number, status: ExpenseStatus = 'PAID', locationId: string | null | undefined = undefined, expenseDate = new Date()) => prisma.expense.create({ data: {
    expenseNumber: randomUUID(), category, amount, status, expenseDate, description: category === 'PAYROLL' ? 'Private employee wages' : 'Inventory acquisition',
    locationId: locationId === undefined ? data.location.id : locationId, userId: data.adminUser.id,
  } });
  const sale = (unitCost: number | null = 4) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), locationId: data.location.id, userId: data.adminUser.id,
    subtotal: 20, tax: 2, total: 22, paymentMethod: 'CASH', amountPaid: 22,
    items: { create: { productId: data.product.id, productName: data.product.name, sku: data.product.sku, quantity: 2, price: 10, tax: 2, total: 22, unitCost } },
  } });
  beforeEach(async () => { data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN'); });

  it('deducts sold merchandise once while retaining payroll and all recorded purchases', async () => {
    await sale();
    await expense('INVENTORY_PURCHASE', 80); await expense('INVENTORY_PURCHASE', 20, 'APPROVED');
    await expense('INVENTORY_PURCHASE', 999, 'PENDING'); await expense('INVENTORY_PURCHASE', 999, 'REJECTED');
    await expense('PAYROLL', 3);
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ netSales: 20, costOfGoodsSold: 8, grossProfit: 12, expenses: 3, operatingProfit: 9, operatingMargin: 45, inventoryPurchases: 100, recordedExpenses: 103 });
    const pnl = (await get('/financial/reports/pnl').expect(200)).body.data;
    expect(pnl).toMatchObject({ netIncome: 9, inventoryPurchases: 100, recordedExpenses: 103, operatingExpenses: { total: 3, byCategory: [{ category: 'PAYROLL', amount: 3 }] } });
    expect((await get('/reports/overall').expect(200)).body.data.profitability).toMatchObject({ netProfit: 9, totalExpenses: 3, inventoryPurchases: 100 });
    expect((await get('/analytics/business-health').expect(200)).body.data.profitability).toMatchObject({ netProfit: 9, expenses: 3, inventoryPurchases: 100 });
    const dashboard = await getAdminDashboard('max');
    expect(dashboard.totals).toMatchObject({ totalExpenses: 103, totalOperatingExpenses: 3, totalInventoryPurchases: 100, totalProfit: 9, margin: 45 });
    expect(dashboard.locations[0]).toMatchObject({ expenses: 103, operatingExpenses: 3, inventoryPurchases: 100, profit: 9 });
    expect(await prisma.expense.count()).toBe(5);
  });

  it('exports inventory as an asset without claiming unpaid purchases have been paid', async () => {
    const paid = await expense('INVENTORY_PURCHASE', 80), approved = await expense('INVENTORY_PURCHASE', 20, 'APPROVED');
    await expense('PAYROLL', 3);
    const result = (await get('/financial/export/expenses').expect(200)).body.data;
    expect(result).toMatchObject({ totalExpenses: 103, operatingExpenses: 3, inventoryPurchases: 100, recordCount: 3 });
    expect(result.entries.find((e: { reference: string }) => e.reference === paid.expenseNumber)).toMatchObject({ debitAccount: 'Inventory Asset', creditAccount: 'Cash/Bank', amount: 80 });
    expect(result.entries.find((e: { reference: string }) => e.reference === approved.expenseNumber)).toMatchObject({ debitAccount: 'Inventory Asset', creditAccount: 'Accounts Payable', amount: 20 });
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: approved.id } })).status).toBe('APPROVED');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(data.product.stockQuantity);
  });

  it('keeps manager payroll aggregates private and complete alongside purchases', async () => {
    await expense('INVENTORY_PURCHASE', 80); await expense('PAYROLL', 3);
    const manager = await prisma.user.create({ data: { email: 'expenses-manager@test.com', password: data.adminUser.password, firstName: 'Manager', lastName: 'Fixture', role: 'MANAGER', locationId: data.location.id } });
    const auth = await createTestToken(manager.id, 'MANAGER');
    const result = (await get('/financial/export/expenses', auth).expect(200)).body.data;
    expect(result).toMatchObject({ totalExpenses: 83, operatingExpenses: 3, inventoryPurchases: 80 });
    expect(result.entries.find((e: { category: string }) => e.category === 'PAYROLL')).toMatchObject({ reference: 'PAYROLL-SUMMARY-PAID', amount: 3, vendor: null });
    expect(JSON.stringify(result)).not.toContain('Private employee wages');
    expect((await get('/financial/reports/pnl', auth).expect(200)).body.data.operatingExpenses.total).toBe(3);
  });

  it('does not turn unsold stock into COGS or use purchases to invent missing historical costs', async () => {
    await expense('INVENTORY_PURCHASE', 100);
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ costOfGoodsSold: 0, operatingProfit: 0, operatingMargin: null, inventoryPurchases: 100 });
    await sale(null);
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ costOfGoodsSold: null, operatingProfit: null, operatingMargin: null, inventoryPurchases: 100 });
  });

  it('uses store calendar boundaries for expense exports and P&L', async () => {
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    await expense('INVENTORY_PURCHASE', 1, 'PAID', undefined, new Date('2026-03-08T05:59:59Z'));
    await expense('INVENTORY_PURCHASE', 2, 'PAID', undefined, new Date('2026-03-08T06:00:00Z'));
    await expense('INVENTORY_PURCHASE', 4, 'PAID', undefined, new Date('2026-03-09T04:59:59Z'));
    await expense('INVENTORY_PURCHASE', 8, 'PAID', undefined, new Date('2026-03-09T05:00:00Z'));
    const filter = '?startDate=2026-03-08&endDate=2026-03-08';
    const exported = (await get('/financial/export/expenses' + filter).expect(200)).body.data;
    expect(exported).toMatchObject({ inventoryPurchases: 6, totalExpenses: 6, operatingExpenses: 0, recordCount: 2, period: { timezone: 'America/Chicago', endExclusive: true } });
    expect(exported.entries.map((e: { date: string }) => e.date)).toEqual(['2026-03-08', '2026-03-08']);
    expect((await get('/financial/reports/pnl' + filter).expect(200)).body.data).toMatchObject({ inventoryPurchases: 6, netIncome: 0 });
    await get('/financial/export/expenses?startDate=bad').expect(400);
  });

  it('excludes unassigned legacy expenses and scopes purchases to their own store', async () => {
    const other = await prisma.location.create({ data: { name: 'Other store', address: 'Other', city: 'Other', state: 'IL', zipCode: '60000', phone: '555', email: 'other-expenses@test.com' } });
    await expense('INVENTORY_PURCHASE', 2); await expense('INVENTORY_PURCHASE', 5, 'PAID', other.id);
    await expense('INVENTORY_PURCHASE', 99, 'PAID', null); await expense('RENT', 77, 'PAID', null);
    expect((await get('/financial/export/expenses').expect(200)).body.data.inventoryPurchases).toBe(2);
    await get('/financial/export/expenses?locationId=' + other.id).expect(403);
    expect(await getFinancialMetrics({})).toMatchObject({ inventoryPurchases: 7, expenses: 0 });
    const platform = await prisma.user.create({ data: { email: 'expenses-platform@test.com', password: data.adminUser.password, firstName: 'Platform', lastName: 'Fixture', role: 'SUPER_ADMIN' } });
    const auth = await createTestToken(platform.id, 'SUPER_ADMIN');
    expect((await get('/financial/reports/pnl', auth).expect(200)).body.data).toMatchObject({ inventoryPurchases: 7, operatingExpenses: { total: 0, byCategory: [] } });
    expect((await get('/financial/export/expenses', auth).expect(200)).body.data).toMatchObject({ inventoryPurchases: 7, totalExpenses: 7 });
    expect((await getAdminDashboard('max')).totals).toMatchObject({ totalInventoryPurchases: 7, totalExpenses: 7, totalProfit: 0 });
  });
});
