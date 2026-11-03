import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma, seedTestData, TestData } from './setup';
import { api, createTestToken } from './helpers';
import { sendEmail } from '../../utils/email';
import {jobPayload} from '../../services/jobQueue.service';

jest.mock('../../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));

describe('Fixed precision financial storage and numeric API compatibility', () => {
  let data: TestData, token: string;
  beforeEach(async () => { data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN'); });

  it('stores booked money as numeric cents and unit costs/rates at additional precision', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string; data_type: string; numeric_scale: number }[]>`
      SELECT table_name, column_name, data_type, numeric_scale FROM information_schema.columns
      WHERE table_schema = 'public' AND ((table_name = 'sales' AND column_name = 'total')
        OR (table_name = 'products' AND column_name = 'cost') OR (table_name = 'locations' AND column_name = 'taxRate'))`;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ table_name: 'sales', column_name: 'total', data_type: 'numeric', numeric_scale: 2 }),
      expect.objectContaining({ table_name: 'products', column_name: 'cost', data_type: 'numeric', numeric_scale: 4 }),
      expect.objectContaining({ table_name: 'locations', column_name: 'taxRate', data_type: 'numeric', numeric_scale: 4 }),
    ]));
    const floating = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'double precision'`;
    expect(Number(floating[0].count)).toBe(0);
  });

  it('keeps concurrent cent increments exact without lost updates', async () => {
    const account = await prisma.storeCreditAccount.create({ data: { customerId: data.customer.id, locationId: data.location.id } });
    await Promise.all(Array.from({ length: 10 }, () => prisma.storeCreditAccount.update({ where: { id: account.id }, data: { balance: { increment: new Prisma.Decimal('0.01') } } })));
    const saved = await prisma.storeCreditAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(Prisma.Decimal.isDecimal(saved.balance)).toBe(true); expect(saved.balance.equals('0.10')).toBe(true);
    const raw = await prisma.$queryRaw<{ amount: string }[]>`SELECT balance::text AS amount FROM store_credit_accounts WHERE id = ${account.id}`;
    expect(raw[0].amount).toBe('0.10');
  });

  it('quotes, books and returns a half-cent unit-price transaction consistently', async () => {
    await prisma.product.update({ where: { id: data.product.id }, data: { price: '1.0050', cost: '0.1234' } });
    await api.post('/api/financial/inventory-costs/opening').withAuth(token).withBody({ idempotencyKey: randomUUID(), notes: 'Verified opening count and invoice value',
      items: [{ productId: data.product.id, quantity: 100, value: 12.34, expectedVersion: data.product.stockVersion }] }).expectStatus(200).execute();
    await prisma.location.update({ where: { id: data.location.id }, data: { taxRate: 5, settings: {
      receiptSettings: { header: '<shared header>', footer: 'Shared footer', showAddress: false, showTaxBreakdown: true },
    } } });
    const items = [{ productId: data.product.id, price: 1.005, quantity: 3 }];
    const quote = await api.post('/api/sales/quote').withAuth(token).withBody({ items }).execute();
    expect({ status: quote.status, error: quote.body.error }).toEqual({ status: 200 });
    expect(quote.body.data).toMatchObject({ subtotal: 3.02, totalTax: 0.15, total: 3.17 });
    await api.post('/api/shifts/clock-in').withAuth(token).withBody({ startingCash: 0 }).expectStatus(201).execute();
    const sold = await api.post('/api/sales').withAuth(token).withBody({ items, paymentMethod: 'CASH', amountPaid: 3.17, expectedTotal: 3.17 }).expectStatus(201).execute();
    expect(sold.body.data.total).toBe(3.17); expect(sold.body.data.items[0]).toMatchObject({ price: 1.005, total: 3.17, unitCost: 0.1234 });
    const saved = await prisma.sale.findUniqueOrThrow({ where: { id: sold.body.data.id } });
    expect(saved.total.equals('3.17')).toBe(true);
    await api.post('/api/sales/' + saved.id + '/email-receipt').withAuth(token).withBody({ email: 'receipt@example.test' }).expectStatus(200).execute();
    expect(sendEmail).not.toHaveBeenCalled();
    const email = jobPayload(await prisma.backgroundJob.findFirstOrThrow({where:{kind:'EMAIL',label:'RECEIPT'}}));
    expect(email.html).toContain('$1.005'); expect(email.html).toContain('$3.02'); expect(email.html).toContain('$3.17');
    expect(email.html).toContain('<h1>Test Store</h1>');
    expect(email.html).toContain('&lt;shared header&gt;'); expect(email.html).toContain('Shared footer');
    expect(email.html).not.toContain('123 Test St');
    const refund = await api.post('/api/sales/' + saved.id + '/refund').withAuth(token)
      .withBody({ amount: 3.17, reason: 'Precision return', expectedAmount: 3.17 }).expectStatus(200).execute();
    expect(refund.body.refund.amount).toBe(3.17);
    const entries = await prisma.drawerEntry.aggregate({ where: { saleId: saved.id }, _sum: { amount: true } });
    expect(entries._sum.amount?.equals(0)).toBe(true);
  });
});
