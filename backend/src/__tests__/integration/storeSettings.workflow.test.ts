import { prisma, seedTestData, TestData } from './setup';
import { api, createTestToken } from './helpers';

const receipt = { header: 'Fresh store header', footer: 'Come again', showAddress: true, showTaxBreakdown: true };
const payments = { cash: true, card: true, giftCard: false, storeCredit: false };
describe('Store settings ownership, validation and concurrent updates', () => {
  let data: TestData, owner: string, manager: string, cashier: string, platform: string;
  beforeEach(async () => {
    data = await seedTestData();
    const managed = await prisma.user.create({ data: { email: 'manager@example.test', password: 'unused', firstName: 'Manager', lastName: 'Test', role: 'MANAGER', locationId: data.location.id } });
    const admin = await prisma.user.create({ data: { email: 'platform@example.test', password: 'unused', firstName: 'Platform', lastName: 'Test', role: 'SUPER_ADMIN' } });
    [owner, manager, cashier, platform] = await Promise.all([
      createTestToken(data.adminUser.id, 'ADMIN'), createTestToken(managed.id, 'MANAGER'),
      createTestToken(data.cashierUser.id, 'CASHIER'), createTestToken(admin.id, 'SUPER_ADMIN'),
    ]);
  });
  const update = (token: string, body: unknown) => api.put('/api/locations/my-settings').withAuth(token).withBody(body).execute();

  it('requires explicit platform scope and denies foreign settings and platform writes', async () => {
    await api.get('/api/locations/my-settings').withAuth(platform).expectStatus(400).execute();
    await api.get('/api/locations/my-settings').withAuth(platform).withQuery({ locationId: data.location.id }).expectStatus(200).execute();
    await api.get('/api/locations/my-settings').withAuth(cashier).withQuery({ locationId: 'foreign-store' }).expectStatus(403).execute();
    expect((await update(owner, { locationId: 'foreign-store', receiptSettings: receipt })).status).toBe(403);
    expect((await update(platform, { locationId: data.location.id, receiptSettings: receipt })).status).toBe(403);
    expect((await update(cashier, { receiptSettings: receipt })).status).toBe(403);
  });

  it('permits manager receipt changes but reserves tax and payment rules for the owner', async () => {
    expect((await update(manager, { receiptSettings: receipt })).status).toBe(200);
    expect((await update(manager, { paymentMethods: payments })).status).toBe(403);
    expect((await update(manager, { storeInfo: { taxRate: 5 } })).status).toBe(403);
    expect((await update(manager, { storeInfo: { taxRate: 10, storeName: 'Manager rename' } })).status).toBe(200);
    expect((await update(owner, { storeInfo: { taxRate: 8.875 } })).status).toBe(200);
    const saved = await prisma.location.findUniqueOrThrow({ where: { id: data.location.id } });
    expect(saved.address).toBe('123 Test St'); expect(Number(saved.taxRate)).toBe(8.875);
    const audit = await prisma.activityLog.findFirstOrThrow({ where: { action: 'STORE_SETTINGS_UPDATED', userId: data.adminUser.id } });
    expect(audit.details).toMatchObject({ previousTaxRate: 10, taxRate: 8.875 });
  });

  it('merges simultaneous section saves without losing either configuration', async () => {
    const responses = await Promise.all([update(owner, { receiptSettings: receipt }), update(owner, { paymentMethods: payments })]);
    expect(responses.map(result => result.status)).toEqual([200, 200]);
    const saved = await prisma.location.findUniqueOrThrow({ where: { id: data.location.id } });
    expect(saved.settings).toMatchObject({ receiptSettings: receipt, paymentMethods: payments });
    expect(await prisma.activityLog.count({ where: { action: 'STORE_SETTINGS_UPDATED' } })).toBe(2);
  });

  it('rejects malformed and unknown settings without modifying records', async () => {
    for (const body of [
      { storeInfo: { taxRate: 101 } }, { storeInfo: { taxRate: 0.12345 } }, { storeInfo: { storeName: '' } },
      { receiptSettings: { ...receipt, hiddenScript: 'bad' } }, { receiptSettings: { ...receipt, footer: 'x'.repeat(1001) } },
      { paymentMethods: { cash: false, card: false, giftCard: false, storeCredit: false } },
      { paymentMethods: { ...payments, card: 'yes' } }, { notificationSettings: { notificationEmail: 'invalid' } },
      { userId: data.adminUser.id },
    ]) expect((await update(owner, body)).status).toBe(400);
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it('limits cashier store lookups to configuration and their own shift', async () => {
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date(), startingCash: 200, hourlyRate: 99 } });
    const own = await prisma.shift.create({ data: { userId: data.cashierUser.id, locationId: data.location.id, clockInAt: new Date(), startingCash: 0 } });
    await prisma.location.update({ where: { id: data.location.id }, data: { settings: { privateToken: 'secret', receiptSettings: receipt } } });
    const result = await api.get('/api/locations/' + data.location.id).withAuth(cashier).expectStatus(200).execute();
    expect(result.body.data.activeShifts).toEqual([expect.objectContaining({ id: own.id })]);
    for (const key of ['users', 'recentSales', 'totalRevenue', '_count']) expect(result.body.data).not.toHaveProperty(key);
    expect(result.body.data.settings).toEqual({ receiptSettings: receipt });
    expect(JSON.stringify(result.body)).not.toContain('privateToken');
  });

  it('keeps inactive settings readable but blocks configuration changes', async () => {
    await prisma.location.update({ where: { id: data.location.id }, data: { isActive: false } });
    await api.get('/api/locations/my-settings').withAuth(owner).expectStatus(200).execute();
    expect((await update(owner, { receiptSettings: receipt })).status).toBe(409);
    expect(await prisma.activityLog.count()).toBe(0);
  });
});
