/**
 * House Account Integration Tests
 *
 * Charge-to-account tender: account required, credit limit enforced inside
 * the sale transaction, payments reduce the balance.
 */

import { randomUUID } from 'crypto';
import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, loginUser } from './helpers';

describe('House Account Integration Tests', () => {
  let testData: TestData;
  let cashierToken: string;
  let adminToken: string;

  beforeEach(async () => {
    testData = await seedTestData();
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');
    adminToken = await loginUser('admin@test.com', 'Admin123!');
    await api
      .post('/api/shifts/clock-in')
      .withAuth(cashierToken)
      .withBody({ startingCash: 100 })
      .expectStatus(201)
      .execute();
  });

  const houseSale = (amount: number, extra: Record<string, any> = {}) => ({
    idempotencyKey: randomUUID(),
    customerId: testData.customer.id,
    items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
    paymentMethod: 'HOUSE_ACCOUNT',
    amountPaid: amount,
    payments: [{ paymentMethod: 'HOUSE_ACCOUNT', amount }],
    ...extra,
  });

  it('should reject charging without a house account', async () => {
    const res = await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody(houseSale(21.99))
      .expectStatus(400)
      .execute();

    assertResponse.error(res, 'no active house account');
  });

  it('should reject charging without a linked customer', async () => {
    const res = await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody({ ...houseSale(21.99), customerId: undefined })
      .expectStatus(400)
      .execute();

    assertResponse.error(res, 'customer must be linked');
  });

  it('should charge the account, enforce the limit, and take payments', async () => {
    // Open a $30 account via the API
    const created = await api
      .post('/api/house-accounts')
      .withAuth(adminToken)
      .withBody({ customerId: testData.customer.id, creditLimit: 30 })
      .expectStatus(201)
      .execute();
    const accountId = created.body.data.id;

    // Charge $21.99 — within limit
    await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody(houseSale(21.99))
      .expectStatus(201)
      .execute();

    let account = await prisma.houseAccount.findUnique({
      where: { id: accountId },
      include: { transactions: true },
    });
    expect(account!.balance).toBe(21.99);
    expect(account!.transactions).toHaveLength(1);
    expect(account!.transactions[0].type).toBe('CHARGE');
    expect(account!.transactions[0].saleId).not.toBeNull();

    // A second identical charge would push the balance past $30 — refused,
    // and the failed sale must not move stock or the balance
    const stockBefore = (await prisma.product.findUnique({ where: { id: testData.product.id } }))!.stockQuantity;
    const over = await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody(houseSale(21.99))
      .expectStatus(400)
      .execute();
    assertResponse.error(over, 'credit limit exceeded');

    account = await prisma.houseAccount.findUnique({ where: { id: accountId }, include: { transactions: true } });
    expect(account!.balance).toBe(21.99);
    const stockAfter = (await prisma.product.findUnique({ where: { id: testData.product.id } }))!.stockQuantity;
    expect(stockAfter).toBe(stockBefore);

    // Customer pays $15 at the counter
    const payment = await api
      .post(`/api/house-accounts/${accountId}/payment`)
      .withAuth(adminToken)
      .withBody({ amount: 15, notes: 'Cash payment' })
      .expectStatus(200)
      .execute();
    expect(payment.body.data.balance).toBe(6.99);

    // Now the same charge fits again
    await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody(houseSale(21.99))
      .expectStatus(201)
      .execute();

    const finalAccount = await prisma.houseAccount.findUnique({ where: { id: accountId } });
    expect(finalAccount!.balance).toBe(28.98);
  });

  it('should refuse charges on a frozen account', async () => {
    const created = await api
      .post('/api/house-accounts')
      .withAuth(adminToken)
      .withBody({ customerId: testData.customer.id, creditLimit: 100 })
      .expectStatus(201)
      .execute();

    await api
      .put(`/api/house-accounts/${created.body.data.id}`)
      .withAuth(adminToken)
      .withBody({ isActive: false })
      .expectStatus(200)
      .execute();

    const res = await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody(houseSale(21.99))
      .expectStatus(400)
      .execute();
    assertResponse.error(res, 'no active house account');
  });

  it('should block cashiers from account management', async () => {
    await api
      .post('/api/house-accounts')
      .withAuth(cashierToken)
      .withBody({ customerId: testData.customer.id, creditLimit: 100 })
      .expectStatus(403)
      .execute();
  });
});
