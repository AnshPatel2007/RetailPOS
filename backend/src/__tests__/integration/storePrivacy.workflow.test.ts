import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData } from './setup';
import { createTestToken } from './helpers';

it('denies cashier financial, audit and payroll reads and excludes wages from staff and shifts', async () => {
  const data = await seedTestData();
  const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
  const owner = await createTestToken(data.adminUser.id, 'ADMIN');
  await prisma.user.update({ where: { id: data.cashierUser.id }, data: { hourlyRate: 27.31 } });
  await prisma.shift.create({ data: { userId: data.cashierUser.id, locationId: data.location.id, clockInAt: new Date(), hourlyRate: 27.31 } });
  for (const path of ['/financial/reports/pnl', '/audit-logs', '/payroll', '/payroll/expenses/unknown']) {
    await request(app).get('/api' + path).set('Authorization', 'Bearer ' + cashier).expect(403);
  }
  for (const [token, path] of [[owner, '/users'], [cashier, '/shifts'], [cashier, '/shifts/current']]) {
    const result = await request(app).get('/api' + path).set('Authorization', 'Bearer ' + token).expect(200);
    expect(JSON.stringify(result.body)).not.toMatch(/hourlyRate|grossPay|"password"/);
  }
});
