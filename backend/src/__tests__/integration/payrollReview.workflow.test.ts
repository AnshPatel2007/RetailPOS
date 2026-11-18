import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { generatePayrollExpenses, recordShiftWages } from '../../services/payroll.service';

describe('Payroll review, payment and immutable recovery', () => {
  let data: TestData, token: string;
  const post = (path: string, body: object = {}, auth = token) => request(app).post('/api' + path).set('Authorization', 'Bearer ' + auth).send(body);
  const get = (path: string, auth = token) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + auth);
  const expense = () => prisma.expense.create({ data: { expenseNumber: randomUUID(), category: 'PAYROLL', description: 'Recorded gross wages', amount: 160, userId: data.cashierUser.id, locationId: data.location.id } });
  const body = (row: { amount: unknown; updatedAt: Date }, action: string) => ({ action, expectedAmount: Number(row.amount), expectedUpdatedAt: row.updatedAt.toISOString(), reason: 'Reviewed original shift records', idempotencyKey: randomUUID() });
  beforeEach(async () => { data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN'); });

  it('serializes approval retries and binds key, amount, reason and version', async () => {
    const row = await expense(), payload = body(row, 'APPROVE');
    const responses = await Promise.all([post(`/payroll/expenses/${row.id}/review`, payload), post(`/payroll/expenses/${row.id}/review`, payload)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]); expect(responses.filter(response => response.body.replayed)).toHaveLength(1);
    expect(await prisma.operationReceipt.count()).toBe(1);
    await post(`/payroll/expenses/${row.id}/review`, { ...payload, reason: 'Changed reason' }).expect(409);
    await post(`/payroll/expenses/${row.id}/review`, { ...payload, idempotencyKey: randomUUID() }).expect(409);
    const receipt = await prisma.operationReceipt.findFirstOrThrow();
    await expect(prisma.operationReceipt.update({ where: { id: receipt.id }, data: { result: {} } })).rejects.toThrow();
    await expect(prisma.operationReceipt.delete({ where: { id: receipt.id } })).rejects.toThrow();
  });

  it('records one cash payment from the paying drawer and replays after closure', async () => {
    let row = await expense();
    await post('/shifts/clock-in', { startingCash: 200 }).expect(201);
    const payment = { paymentMethod: 'DRAWER_CASH', reference: 'WAGE-RECEIPT-1', paidAt: new Date().toISOString() };
    await post(`/payroll/expenses/${row.id}/review`, { ...body(row, 'PAY'), ...payment }).expect(409);
    await post(`/payroll/expenses/${row.id}/review`, body(row, 'APPROVE')).expect(200);
    row = await prisma.expense.findUniqueOrThrow({ where: { id: row.id } }); const payload = { ...body(row, 'PAY'), ...payment };
    const responses = await Promise.all([post(`/payroll/expenses/${row.id}/review`, payload), post(`/payroll/expenses/${row.id}/review`, payload)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect((await get('/shifts/current').expect(200)).body.data.expectedDrawer).toBe(40);
    expect(await prisma.drawerEntry.count({ where: { type: 'PAYROLL' } })).toBe(1);
    await post('/shifts/clock-out', { endingCash: 40 }).expect(200);
    expect((await post(`/payroll/expenses/${row.id}/review`, payload).expect(200)).body.replayed).toBe(true);
    const history = (await get(`/payroll/expenses/${row.id}`).expect(200)).body.data.history;
    expect(history).toHaveLength(2); expect(history[0].result).toMatchObject({ status: 'PAID', reference: 'WAGE-RECEIPT-1', paymentMethod: 'DRAWER_CASH' });
  });

  it('requires a reason, stale-state review and payment evidence, with controlled rejection/reopening', async () => {
    let row = await expense();
    await post(`/payroll/expenses/${row.id}/review`, { ...body(row, 'APPROVE'), reason: ' ' }).expect(400);
    await post(`/payroll/expenses/${row.id}/review`, { ...body(row, 'APPROVE'), expectedAmount: 1 }).expect(409);
    await post(`/payroll/expenses/${row.id}/review`, body(row, 'REJECT')).expect(200);
    row = await prisma.expense.findUniqueOrThrow({ where: { id: row.id } });
    await post(`/payroll/expenses/${row.id}/review`, body(row, 'APPROVE')).expect(409);
    await post(`/payroll/expenses/${row.id}/review`, body(row, 'REOPEN')).expect(200);
    row = await prisma.expense.findUniqueOrThrow({ where: { id: row.id } });
    await post(`/payroll/expenses/${row.id}/review`, body(row, 'APPROVE')).expect(200);
    row = await prisma.expense.findUniqueOrThrow({ where: { id: row.id } });
    await post(`/payroll/expenses/${row.id}/review`, body(row, 'PAY')).expect(400);
    await post(`/payroll/expenses/${row.id}/review`, { ...body(row, 'PAY'), paymentMethod: 'BANK_TRANSFER', reference: 'BANK-1', paidAt: new Date(Date.now() + 86400000).toISOString() }).expect(400);
  });

  it('blocks generic expense state bypasses and restricts all wage details to the owner', async () => {
    const row = await expense();
    await post(`/expenses/${row.id}/approve`).expect(400); await post(`/expenses/${row.id}/reject`).expect(400);
    await post('/expenses/bulk-approve', { expenseIds: [row.id] }).expect(400);
    await post('/expenses/bulk-reject', { expenseIds: [row.id] }).expect(400);
    await request(app).put('/api/expenses/' + row.id).set('Authorization', 'Bearer ' + token).send({ status: 'PAID' }).expect(400);
    const manager = await prisma.user.create({ data: { email: 'payroll-manager@test.com', password: data.adminUser.password, firstName: 'Manager', lastName: 'User', role: 'MANAGER', locationId: data.location.id } });
    const auth = await createTestToken(manager.id, 'MANAGER');
    await get(`/payroll/expenses/${row.id}`, auth).expect(403);
    await post(`/payroll/expenses/${row.id}/review`, body(row, 'APPROVE'), auth).expect(403);
  });

  it('creates a separate obligation for late wages after payment without rewriting the paid amount', async () => {
    const shift = async (hours: number) => prisma.shift.create({ data: { userId: data.cashierUser.id, locationId: data.location.id, clockInAt: new Date('2026-01-20T14:00:00Z'), clockOutAt: new Date(new Date('2026-01-20T14:00:00Z').getTime() + hours * 3600000), isClosed: true, hourlyRate: 20, payrollFrequency: 'WEEKLY', payrollTimezone: 'America/Chicago' } });
    await prisma.$transaction(async tx => recordShiftWages(tx, await shift(8)));
    await generatePayrollExpenses(); let row = await prisma.expense.findFirstOrThrow({ where: { category: 'PAYROLL' } });
    expect(row.expenseNumber).toMatch(/^EXP-\d{6,}$/);
    expect(row.referenceKey).toMatch(/^PAY-/);
    // A pre-migration obligation used its scheduler key as the printed number.
    row = await prisma.expense.update({ where: { id: row.id }, data: { expenseNumber: row.referenceKey!, referenceKey: null } });
    await post(`/payroll/expenses/${row.id}/review`, body(row, 'APPROVE')).expect(200);
    row = await prisma.expense.findUniqueOrThrow({ where: { id: row.id } });
    await post(`/payroll/expenses/${row.id}/review`, { ...body(row, 'PAY'), paymentMethod: 'BANK_TRANSFER', reference: 'BANK-160', paidAt: new Date().toISOString() }).expect(200);
    await prisma.$transaction(async tx => recordShiftWages(tx, await shift(2))); await generatePayrollExpenses();
    expect(Number((await prisma.expense.findUniqueOrThrow({ where: { id: row.id } })).amount)).toBe(160);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PAID');
    const extra = await prisma.expense.findFirstOrThrow({ where: { category: 'PAYROLL', status: 'PENDING' } }); expect(Number(extra.amount)).toBe(40);
  });
});
