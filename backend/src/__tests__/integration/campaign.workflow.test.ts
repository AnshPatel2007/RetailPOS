/**
 * Campaign Segment Integration Tests
 *
 * Segment resolution for email campaigns (opted-in only, lapsed/top/tag
 * filters) and birthday-date handling on the customer API.
 */

import { prisma, seedTestData } from './setup';
import { api, loginUser } from './helpers';

describe('Campaign Segment Integration Tests', () => {
  let adminToken: string;
  let cashierToken: string;

  const daysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  };

  beforeEach(async () => {
    await seedTestData();
    adminToken = await loginUser('admin@test.com', 'Admin123!');
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');

    // Opted-in regular (recent visit)
    await prisma.customer.create({
      data: {
        firstName: 'Recent', lastName: 'Shopper', phone: '555-1001',
        email: 'recent@test.com', emailMarketing: true,
        lastVisitAt: daysAgo(2), totalSpent: 50,
      },
    });
    // Opted-in lapsed 45 days, tagged vip
    await prisma.customer.create({
      data: {
        firstName: 'Lapsed', lastName: 'Vip', phone: '555-1002',
        email: 'lapsed@test.com', emailMarketing: true,
        lastVisitAt: daysAgo(45), totalSpent: 900, tags: ['vip'],
      },
    });
    // NOT opted in — must never be contacted
    await prisma.customer.create({
      data: {
        firstName: 'Private', lastName: 'Person', phone: '555-1003',
        email: 'private@test.com', emailMarketing: false,
        lastVisitAt: daysAgo(90), totalSpent: 2000,
      },
    });
    // Opted in but no email — unreachable
    await prisma.customer.create({
      data: {
        firstName: 'No', lastName: 'Email', phone: '555-1004',
        emailMarketing: true, lastVisitAt: daysAgo(45),
      },
    });
  });

  const preview = async (segment: string) => {
    const res = await api
      .get(`/api/customers/campaign/preview?segment=${encodeURIComponent(segment)}`)
      .withAuth(adminToken)
      .expectStatus(200)
      .execute();
    return res.body.data.matched;
  };

  it('should only count opted-in customers with an email', async () => {
    expect(await preview('all')).toBe(2); // recent + lapsed vip
  });

  it('should resolve lapsed segments by last visit', async () => {
    expect(await preview('lapsed30')).toBe(1); // only the 45-day lapsed customer
    expect(await preview('lapsed60')).toBe(0);
  });

  it('should resolve tag segments case-insensitively', async () => {
    expect(await preview('tag:VIP')).toBe(1);
    expect(await preview('tag:nobody')).toBe(0);
  });

  it('should reject campaigns from non-admins', async () => {
    await api
      .post('/api/customers/campaign')
      .withAuth(cashierToken)
      .withBody({ segment: 'all', subject: 'Hi', message: 'Test' })
      .expectStatus(403)
      .execute();
  });

  it('should report matched counts when sending a campaign', async () => {
    const res = await api
      .post('/api/customers/campaign')
      .withAuth(adminToken)
      .withBody({ segment: 'tag:vip', subject: 'Hello {firstName}', message: 'A deal for you' })
      .expectStatus(200)
      .execute();

    // SMTP isn't configured under test, so delivery may fail — but the segment
    // math (who would receive it) is what we're asserting
    expect(res.body.data.matched).toBe(1);
  });

  it('should store customer birthdays from the form date string', async () => {
    const res = await api
      .post('/api/customers')
      .withAuth(adminToken)
      .withBody({
        firstName: 'Birthday', lastName: 'Person', phone: '555-2001',
        birthDate: '1990-07-19',
      })
      .expectStatus(201)
      .execute();

    const stored = await prisma.customer.findUnique({ where: { id: res.body.data.id } });
    expect(stored!.birthDate).not.toBeNull();
    expect(new Date(stored!.birthDate!).getFullYear()).toBe(1990);
  });
});
