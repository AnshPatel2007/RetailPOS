import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData } from './setup';
import { createTestToken } from './helpers';
import { nextDocumentNumber, nextDocumentSequence } from '../../services/documentNumber.service';
import { generateSaleNumber } from '../../utils/saleNumber';

it('reserves distinct compact references concurrently and never reuses a rolled-back sequence', async () => {
  const references = await Promise.all(Array.from({ length: 50 }, () => nextDocumentNumber('PO')));
  expect(new Set(references).size).toBe(50);
  expect(references.every(value => /^PO-\d{6,}$/.test(value))).toBe(true);
  let reserved = 0n;
  await expect(prisma.$transaction(async tx => { reserved = await nextDocumentSequence(tx); throw Error('Rollback fixture'); })).rejects.toThrow('Rollback fixture');
  expect(await nextDocumentSequence()).toBeGreaterThan(reserved);
});

it('finds new receipts by full reference or short number, retains old references and enforces store scope', async () => {
  const data = await seedTestData();
  const token = await createTestToken(data.adminUser.id, 'ADMIN');
  const serial = await nextDocumentSequence();
  const reference = generateSaleNumber(new Date('2026-10-24T04:59:59Z'), 'America/Chicago', serial);
  const create = (saleNumber: string, locationId = data.location.id) => prisma.sale.create({ data: {
    saleNumber, userId: data.adminUser.id, locationId, total: 10, subtotal: 10, tax: 0, amountPaid: 10, paymentMethod: 'CASH',
  } });
  const sale = await create(reference);
  const legacy = await create('SALE-20261024-' + randomUUID());
  for (const [query, id] of [[reference, sale.id], [serial.toString(), sale.id], [legacy.saleNumber, legacy.id]]) {
    const response = await request(app).get('/api/sales').query({ saleNumber: query }).set('Authorization', 'Bearer ' + token).expect(200);
    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([id]);
  }
  const other = await prisma.location.create({ data: { name: 'Other store', address: 'Other', city: 'Other', state: 'IL', zipCode: '00000', phone: '5550000000', email: 'other@example.test' } });
  const otherSerial = await nextDocumentSequence();
  await create(generateSaleNumber(new Date(), 'America/Chicago', otherSerial), other.id);
  const response = await request(app).get('/api/sales').query({ saleNumber: otherSerial.toString() }).set('Authorization', 'Bearer ' + token).expect(200);
  expect(response.body.data).toEqual([]);
});

it('keeps legacy recurring expense deduplication while new generated expenses use short numbers', async () => {
  const data = await seedTestData(), token = await createTestToken(data.adminUser.id, 'ADMIN');
  const due = new Date(); due.setUTCDate(due.getUTCDate() - 1);
  const createRecurring = () => prisma.recurringExpense.create({ data: { category: 'RENT', description: 'Recurring fixture', amount: 200, frequency: 'MONTHLY', startDate: due, nextDueDate: due, locationId: data.location.id, userId: data.adminUser.id } });
  const old = await createRecurring();
  await prisma.expense.create({ data: { expenseNumber: 'REC-' + old.id + '-' + due.getTime(), category: 'RENT', description: 'Legacy fixture', amount: 200, expenseDate: due, locationId: data.location.id, userId: data.adminUser.id } });
  const fresh = await createRecurring();
  for (let retry = 0; retry < 2; retry++) await request(app).post('/api/financial/recurring-expenses/generate').set('Authorization', 'Bearer ' + token).expect(200);
  expect(await prisma.expense.count()).toBe(2);
  const generated = await prisma.expense.findUniqueOrThrow({ where: { referenceKey: 'REC-' + fresh.id + '-' + due.getTime() } });
  expect(generated.expenseNumber).toMatch(/^EXP-\d{6,}$/);
  expect(Number(generated.amount)).toBe(200);
});
