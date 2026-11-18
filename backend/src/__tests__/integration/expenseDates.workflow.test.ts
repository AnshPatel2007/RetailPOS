import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Store-calendar expense entry, filters and downloads', () => {
  let data: TestData, token: string;
  const get = (path: string) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + token);
  const create = (body: object) => request(app).post('/api/expenses').set('Authorization', 'Bearer ' + token).send({ category: 'INVENTORY_PURCHASE', amount: 10, description: 'Calendar purchase', ...body });
  beforeEach(async () => {
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
  });

  it('creates an expense with no due date and keeps its store day through update and exports', async () => {
    const created = (await create({ expenseDate: '2026-03-08', dueDate: '' }).expect(201)).body.data;
    expect(created).toMatchObject({ expenseDate: '2026-03-08T06:00:00.000Z', dueDate: null, location: { timezone: 'America/Chicago' } });
    await request(app).post('/api/expenses/' + created.id + '/approve').set('Authorization', 'Bearer ' + token).expect(200);
    const query = '?startDate=2026-03-08&endDate=2026-03-08';
    expect((await get('/expenses' + query).expect(200)).body.data.map((e: { id: string }) => e.id)).toEqual([created.id]);
    expect((await get('/reports/expenses' + query).expect(200)).body.data).toMatchObject({ period: { timezone: 'America/Chicago' }, summary: { totalExpenses: 10 } });
    expect((await get('/financial/reports/pnl' + query).expect(200)).body.data.inventoryPurchases).toBe(10);
    const csv = await get('/expenses/export/csv' + query).expect(200);
    expect(csv.text).toContain('"2026-03-08"'); expect(csv.text).toContain(created.expenseNumber);
    const pdf = await get('/expenses/export/pdf' + query).expect(200); expect(pdf.headers['content-type']).toContain('application/pdf');
    const updated = await request(app).put('/api/expenses/' + created.id).set('Authorization', 'Bearer ' + token).send({ expenseDate: '2026-11-01', dueDate: '2026-11-02' }).expect(200);
    expect(updated.body.data).toMatchObject({ expenseDate: '2026-11-01T05:00:00.000Z', dueDate: '2026-11-02T06:00:00.000Z' });
  });

  it('includes late-night expenses on the store day across every list and export', async () => {
    for (const [suffix, date] of [['FIRST', '2026-03-08T06:00:00Z'], ['LAST', '2026-03-09T04:59:59Z'], ['NEXT', '2026-03-09T05:00:00Z']]) {
      await prisma.expense.create({ data: { expenseNumber: 'DATE-' + suffix, category: 'OTHER', description: 'Boundary', amount: 10, status: 'PAID', expenseDate: new Date(date), locationId: data.location.id, userId: data.adminUser.id } });
    }
    const query = '?startDate=2026-03-08&endDate=2026-03-08';
    expect((await get('/expenses' + query).expect(200)).body.data).toHaveLength(2);
    expect((await get('/reports/expenses' + query).expect(200)).body.data.summary.totalExpenses).toBe(20);
    const csv = (await get('/expenses/export/csv' + query).expect(200)).text;
    expect(csv).toContain('DATE-LAST'); expect(csv).not.toContain('DATE-NEXT');
    expect((await get('/financial/export/expenses' + query).expect(200)).body.data.entries.map((e: { date: string }) => e.date)).toEqual(['2026-03-08', '2026-03-08']);
  });

  it('preserves explicit timestamps and future obligations without rewriting legacy records', async () => {
    const original = '2026-10-16T00:00:00.000Z';
    const created = (await create({ expenseDate: original, dueDate: null }).expect(201)).body.data;
    await request(app).put('/api/expenses/' + created.id).set('Authorization', 'Bearer ' + token).send({ description: 'Updated description' }).expect(200);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: created.id } })).expenseDate.toISOString()).toBe(original);
    await create({ expenseDate: '2030-01-01', dueDate: '2030-02-01' }).expect(201);
    expect((await get('/expenses?startDate=2029-01-01').expect(200)).body.data).toHaveLength(1);
    expect((await get('/reports/expenses').expect(200)).body.data.expenses).toHaveLength(2);
  });

  it('rejects invalid dates consistently and excludes unassigned legacy records', async () => {
    for (const value of ['2026-02-30', 'bad', '2026-03-08T12:00:00']) await create({ expenseDate: value }).expect(400);
    for (const path of ['/expenses', '/reports/expenses', '/expenses/export/csv', '/expenses/export/pdf']) await get(path + '?startDate=2026-02-30').expect(400);
    await prisma.expense.create({ data: { expenseNumber: randomUUID(), category: 'OTHER', description: 'Unassigned legacy', amount: 99, userId: data.adminUser.id } });
    const platform = await prisma.user.create({ data: { email: 'calendar-platform@test.com', password: data.adminUser.password, firstName: 'Platform', lastName: 'Fixture', role: 'SUPER_ADMIN' } });
    token = await createTestToken(platform.id, 'SUPER_ADMIN');
    expect((await get('/reports/expenses').expect(200)).body.data.summary.totalExpenses).toBe(0);
    expect((await get('/expenses').expect(200)).body.data).toHaveLength(0);
  });
});
