import { numeric } from '../../utils/money';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { api, createTestToken } from './helpers';
import { receiptDirectory } from '../../services/receiptAttachment.service';

describe('Optimization: store isolation and capability boundaries', () => {
  let data: TestData;
  let owner: string;
  let manager: string;
  let superAdmin: string;
  let otherStore: string;
  let otherOwner: string;

  beforeEach(async () => {
    data = await seedTestData();
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    const b = await prisma.location.create({ data: { name: 'Partner', address: '2 Test St', city: 'Test', state: 'TS', zipCode: '12345', phone: '555', email: 'partner@test.com' } });
    otherStore = b.id;
    const partner = await prisma.user.create({ data: { email: 'partner-owner@test.com', password: data.adminUser.password, firstName: 'Partner', lastName: 'Owner', role: 'ADMIN', locationId: b.id } });
    otherOwner = await createTestToken(partner.id, 'ADMIN');
    const m = await prisma.user.create({ data: { email: 'manager@test.com', password: data.adminUser.password, firstName: 'Store', lastName: 'Manager', role: 'MANAGER', locationId: data.location.id } });
    manager = await createTestToken(m.id, 'MANAGER');
    const sa = await prisma.user.create({ data: { email: 'platform@test.com', password: data.adminUser.password, firstName: 'Platform', lastName: 'Admin', role: 'SUPER_ADMIN' } });
    superAdmin = await createTestToken(sa.id, 'SUPER_ADMIN');
    await prisma.storeConnection.create({ data: { locationAId: data.location.id, locationBId: b.id, createdBy: sa.id } });
  });

  it('rejects cross-store budget mutations and forged ownership at creation', async () => {
    const budget = await prisma.budget.create({ data: { category: 'RENT', amount: 500, period: 'MONTHLY', startDate: new Date(), locationId: otherStore } });
    await api.put(`/api/financial/budgets/${budget.id}`).withAuth(owner).withBody({ amount: 1 }).expectStatus(403).execute();
    await api.delete(`/api/financial/budgets/${budget.id}`).withAuth(owner).expectStatus(403).execute();
    await api.post('/api/financial/budgets').withAuth(owner).withBody({ category: 'RENT', amount: 5, startDate: new Date().toISOString(), locationId: otherStore }).expectStatus(403).execute();
    expect(numeric((await prisma.budget.findUniqueOrThrow({ where: { id: budget.id } })).amount)).toBe(500);
  });

  it('scopes recurring listing/generation and serializes duplicate generation', async () => {
    const due = new Date(); due.setUTCDate(due.getUTCDate() - 1);
    for (const locationId of [data.location.id, otherStore]) await prisma.recurringExpense.create({ data: { category: 'RENT', description: 'Rent', amount: 200, frequency: 'MONTHLY', startDate: due, nextDueDate: due, locationId, userId: data.adminUser.id } });
    const list = await api.get('/api/financial/recurring-expenses').withAuth(owner).expectStatus(200).execute();
    expect(list.body.data).toHaveLength(1);
    await Promise.all([1, 2].map(() => api.post('/api/financial/recurring-expenses/generate').withAuth(owner).expectStatus(200).execute()));
    expect(await prisma.expense.count({ where: { locationId: data.location.id } })).toBe(1);
    expect(await prisma.expense.count({ where: { locationId: otherStore } })).toBe(0);
    const other = await prisma.recurringExpense.findFirstOrThrow({ where: { locationId: otherStore } });
    await api.put(`/api/financial/recurring-expenses/${other.id}`).withAuth(owner).withBody({ amount: 1 }).expectStatus(403).execute();
    await api.delete(`/api/financial/recurring-expenses/${other.id}`).withAuth(owner).expectStatus(403).execute();
  });

  it('gift-card statistics and lists exclude partner and unassigned cards', async () => {
    for (const [code, locationId, amount] of [['OWN', data.location.id, 20], ['OTHER', otherStore, 70], ['UNASSIGNED', null, 90]] as const) {
      await prisma.giftCard.create({ data: { code, locationId, initialBalance: amount, currentBalance: amount } });
    }
    const stats = await api.get('/api/gift-cards/stats').withAuth(owner).expectStatus(200).execute();
    expect(stats.body.data).toEqual({ totalCards: 1, activeCards: 1, outstandingBalance: 20, inactiveBalance: 0 });
    await api.get('/api/gift-cards/UNASSIGNED').withAuth(owner).expectStatus(404).execute();
    await api.get('/api/customers').withAuth(otherOwner).expectStatus(200).execute().then(r => expect(r.body.data).toHaveLength(0));
  });

  it('protects uploads, rejects spoofed contents, and authorizes linking and downloading', async () => {
    await request(app).get('/uploads/receipts/private.pdf').expect(404);
    await request(app).get('/api/expenses/receipts/private.pdf').expect(401);
    await request(app).post('/api/expenses/upload-receipt').set('Authorization', `Bearer ${owner}`).attach('receipt', Buffer.from('<script>bad</script>'), { filename: 'fake.png', contentType: 'image/png' }).expect(400);
    const upload = await request(app).post('/api/expenses/upload-receipt').set('Authorization', `Bearer ${owner}`).attach('receipt', Buffer.from('%PDF-1.4\n%%EOF'), { filename: 'receipt.pdf', contentType: 'application/pdf' }).expect(200);
    const { url, filename } = upload.body.data;
    try {
      await request(app).get(url).set('Authorization', `Bearer ${owner}`).expect(200);
      await request(app).get(url).set('Authorization', `Bearer ${otherOwner}`).expect(403);
      await api.post('/api/expenses').withAuth(otherOwner).withBody({ category: 'OTHER', amount: 10, description: 'Stolen receipt', receiptUrl: url }).expectStatus(403).execute();
      await api.post('/api/expenses').withAuth(owner).withBody({ category: 'OTHER', amount: 10, description: 'Own receipt', receiptUrl: url }).expectStatus(201).execute();
    } finally { await fs.unlink(path.join(receiptDirectory, filename)); }
  });

  it('hides wage details but keeps payroll in operating expenses', async () => {
    const expense = await prisma.expense.create({ data: { expenseNumber: 'PAY-PRIVATE', category: 'PAYROLL', description: 'Private employee pay', amount: 125, userId: data.adminUser.id, locationId: data.location.id, status: 'APPROVED' } });
    await api.get(`/api/expenses/${expense.id}`).withAuth(manager).expectStatus(403).execute();
    await api.get('/api/expenses').withAuth(manager).expectStatus(200).execute().then(r => expect(r.body.data).toHaveLength(0));
    await api.get('/api/reports/expenses').withAuth(manager).expectStatus(200).execute().then(r => { expect(r.body.data.expenses).toHaveLength(0); expect(r.body.data.summary.totalExpenses).toBe(125); });
    await api.get('/api/financial/reports/pnl').withAuth(manager).expectStatus(200).execute().then(r => expect(r.body.data.operatingExpenses.total).toBe(125));
    await api.get('/api/financial/export/expenses').withAuth(manager).expectStatus(200).execute().then(r => {
      expect(r.body.data.totalExpenses).toBe(125);
      expect(r.body.data.byCategory.PAYROLL).toBe(125);
      expect(JSON.stringify(r.body)).not.toContain('Private employee pay');
      expect(JSON.stringify(r.body)).not.toContain('PAY-PRIVATE');
    });
    for (const token of [manager, superAdmin]) await api.get('/api/payroll').withAuth(token).expectStatus(403).execute();
  });

  it('enforces read-only super-admin preview and inactive store writes', async () => {
    await api.post('/api/products').withAuth(superAdmin).withBody({}).expectStatus(403).execute();
    await api.post('/api/customers').withAuth(superAdmin).withBody({}).expectStatus(403).execute();
    await api.get('/api/products').withAuth(superAdmin).withQuery({ locationId: data.location.id }).expectStatus(200).execute();
    await prisma.location.update({ where: { id: data.location.id }, data: { isActive: false } });
    await api.post('/api/expenses').withAuth(owner).withBody({}).expectStatus(403).execute();
    await api.get('/api/expenses').withAuth(owner).expectStatus(200).execute();
  });

  it('scopes inventory cards to the preview store and excludes untracked, misc and unassigned inventory value', async () => {
    await prisma.product.createMany({ data: [
      { name: 'Foreign asset', sku: 'FOREIGN-ASSET', price: 100, cost: 90, stockQuantity: 10, lowStockAlert: 20, locationId: otherStore },
      { name: 'Untracked', sku: 'UNTRACKED', price: 100, cost: 100, stockQuantity: 100, trackInventory: false, locationId: data.location.id },
      { name: 'Misc', sku: 'MISC-001', price: 100, cost: 100, stockQuantity: 100, locationId: data.location.id },
      { name: 'Unassigned asset', sku: 'UNASSIGNED-ASSET', price: 100, cost: 100, stockQuantity: 100 },
    ] });
    const stats = async (token: string, locationId?: string) => (await api.get('/api/products/stats').withAuth(token).withQuery(locationId ? { locationId } : {}).expectStatus(200).execute()).body.data;
    expect((await stats(owner)).inventoryValue).toBeNull();
    expect((await stats(owner)).unvaluedCount).toBeGreaterThan(0);
    // The card reads verified carrying values, never today's catalog prices.
    for (const product of await prisma.product.findMany({ where: { OR: [{ id: data.product.id }, { sku: 'FOREIGN-ASSET' }] } })) {
      await prisma.inventoryValuation.create({ data: { productId: product.id, locationId: product.locationId!, quantity: product.stockQuantity,
        value: product.id === data.product.id ? 1000 : 900, verifiedAt: new Date(), lastEntryId: 'fixture-' + product.id } });
    }
    expect(await stats(owner)).toEqual({ totalProducts: 2, lowStockCount: 0, outOfStockCount: 0, unvaluedCount: 0, inventoryValue: 1000 });
    expect(await stats(superAdmin, data.location.id)).toEqual(await stats(owner));
    expect((await stats(superAdmin, otherStore)).inventoryValue).toBe(900);
    expect((await stats(superAdmin)).inventoryValue).toBe(1900);
    expect((await api.get('/api/products/low-stock').withAuth(superAdmin).withQuery({ locationId: data.location.id }).expectStatus(200).execute()).body.data).toHaveLength(0);
    expect((await api.get('/api/products/low-stock').withAuth(superAdmin).withQuery({ locationId: otherStore }).expectStatus(200).execute()).body.data.map((product: { sku: string }) => product.sku)).toEqual(['FOREIGN-ASSET']);
    await api.get('/api/products/stats').withAuth(owner).withQuery({ locationId: otherStore }).expectStatus(403).execute();
    await api.get('/api/products/stats').withAuth(await createTestToken(data.cashierUser.id, 'CASHIER')).expectStatus(403).execute();
  });

  it('cashiers cannot set up lottery tickets or browse inventory transfers', async () => {
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await api.post('/api/lottery/ticket-types').withAuth(cashier).withBody({}).expectStatus(403).execute();
    await api.get('/api/inventory-transfers').withAuth(cashier).expectStatus(403).execute();
  });

  it('validated payloads cannot reassign inventory or write nested financial records', async () => {
    await api.put('/api/products/' + data.product.id).withAuth(owner).withBody({
      name: 'Updated safely', locationId: otherStore, stockVersion: 999,
      inventoryLogs: { create: { type: 'FORGED', quantity: 100, previousQty: 0, newQty: 100 } },
    }).expectStatus(200).execute();
    const product = await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } });
    expect(product.locationId).toBe(data.location.id); expect(product.stockVersion).toBe(0);
    expect(await prisma.inventoryLog.count({ where: { type: 'FORGED' } })).toBe(0);
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await api.put('/api/customers/' + data.customer.id).withAuth(cashier).withBody({ loyaltyPoints: 999 }).expectStatus(403).execute();
    await api.put('/api/customers/' + data.customer.id).withAuth(cashier).withBody({ totalSpent: 999, firstName: 'Contact edit' }).expectStatus(200).execute();
    expect(numeric((await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } })).totalSpent)).toBe(0);
  });

  it('category parents and product category assignments cannot cross stores', async () => {
    const category = await prisma.category.create({ data: { name: 'Partner private category', locationId: otherStore } });
    await api.post('/api/categories').withAuth(owner).withBody({ name: 'Child', parentId: category.id }).expectStatus(404).execute();
    await api.put('/api/products/' + data.product.id).withAuth(owner).withBody({ categoryId: category.id }).expectStatus(403).execute();
    await api.post('/api/products/bulk-update-category').withAuth(owner).withBody({ productIds: [data.product.id], categoryId: category.id }).expectStatus(403).execute();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).categoryId).toBe(data.category.id);
  });
});
