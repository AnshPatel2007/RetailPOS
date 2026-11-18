/**
 * Customers belong to one store. An email or phone identifies one customer
 * within a store; a second store can have the same person as its own customer
 * and learns nothing about the first store's record.
 */
import bcrypt from 'bcryptjs';
import { prisma, seedTestData, TestData } from './setup';
import { api, createTestToken, loginUser } from './helpers';

describe('customer email and phone are unique per store', () => {
  let data: TestData;
  let ownerA: string;
  let ownerB: string;
  let storeB: { id: string };
  const person = { firstName: 'Pat', lastName: 'Shopper', email: 'pat@example.test', phone: '555-867-5309' };

  beforeEach(async () => {
    data = await seedTestData();
    ownerA = await loginUser('admin@test.com', 'Admin123!');
    storeB = await prisma.location.create({ data: { id: 'test-location-2', name: 'Second Store', address: '2 Test St', city: 'Test', state: 'TS', zipCode: '12345', phone: '555-0102', email: 'second@store.com' } });
    const admin = await prisma.user.create({ data: { email: 'admin-b@test.com', password: await bcrypt.hash('Admin123!', 4), firstName: 'Owner', lastName: 'B', role: 'ADMIN', locationId: storeB.id } });
    ownerB = await createTestToken(admin.id, 'ADMIN');
  });

  it('lets two stores each have the same person, and refuses a duplicate within one store', async () => {
    const first = await api.post('/api/customers').withAuth(ownerA).withBody(person).expectStatus(201).execute();
    const second = await api.post('/api/customers').withAuth(ownerB).withBody(person).expectStatus(201).execute();
    expect(first.body.data.locationId).toBe(data.location.id);
    expect(second.body.data.locationId).toBe(storeB.id);
    expect(second.body.data.id).not.toBe(first.body.data.id);

    const sameEmail = await api.post('/api/customers').withAuth(ownerA).withBody({ ...person, phone: '555-000-1111' }).expectError(400);
    expect(sameEmail.body.error).toBe('Customer with this email already exists');
    const samePhone = await api.post('/api/customers').withAuth(ownerA).withBody({ ...person, email: 'other@example.test' }).expectError(400);
    expect(samePhone.body.error).toBe('Customer with this phone number already exists');
    expect(await prisma.customer.count({ where: { phone: person.phone } })).toBe(2);
    // The database enforces the same rule.
    await expect(prisma.customer.create({ data: { ...person, locationId: storeB.id } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('finds a phone number only among the searching store\'s customers', async () => {
    await api.post('/api/customers').withAuth(ownerA).withBody(person).expectStatus(201).execute();
    const search = (token: string, phone: string) => api.get('/api/customers/search/phone').withAuth(token).withQuery({ phone }).expectSuccess();

    // Store B has no such customer yet: nothing is linked, and nothing says store A has one.
    expect((await search(ownerB, person.phone)).body.data).toBeNull();
    expect((await search(ownerB, '5309')).body.data).toBeNull();

    const theirs = await api.post('/api/customers').withAuth(ownerB).withBody({ ...person, firstName: 'Patricia' }).expectStatus(201).execute();
    expect((await search(ownerB, person.phone)).body.data).toMatchObject({ id: theirs.body.data.id, firstName: 'Patricia', locationId: storeB.id });
    expect((await search(ownerA, person.phone)).body.data).toMatchObject({ firstName: 'Pat', locationId: data.location.id });
    // The last four digits stay unambiguous inside each store although both stores have the number.
    expect((await search(ownerA, '5309')).body.data).toMatchObject({ firstName: 'Pat' });
    expect((await search(ownerB, '5309')).body.data).toMatchObject({ firstName: 'Patricia' });
  });

  it('applies the same rule when a customer is edited', async () => {
    const pat = (await api.post('/api/customers').withAuth(ownerA).withBody(person).expectStatus(201).execute()).body.data;
    const sam = (await api.post('/api/customers').withAuth(ownerA).withBody({ firstName: 'Sam', lastName: 'Shopper', email: 'sam@example.test', phone: '555-222-3333' }).expectStatus(201).execute()).body.data;
    await api.post('/api/customers').withAuth(ownerB).withBody({ firstName: 'Lee', lastName: 'Elsewhere', email: 'lee@example.test', phone: '555-444-5555' }).expectStatus(201).execute();

    const taken = await api.put('/api/customers/' + sam.id).withAuth(ownerA).withBody({ phone: person.phone }).expectError(400);
    expect(taken.body.error).toBe('Customer with this phone number already exists');
    const takenEmail = await api.put('/api/customers/' + sam.id).withAuth(ownerA).withBody({ email: person.email }).expectError(400);
    expect(takenEmail.body.error).toBe('Customer with this email already exists');
    // A number or email used only at another store is free here.
    await api.put('/api/customers/' + sam.id).withAuth(ownerA).withBody({ phone: '555-444-5555', email: 'lee@example.test' }).expectSuccess();
    // Saving a customer without changing their own contact details is not a clash with themselves.
    await api.put('/api/customers/' + pat.id).withAuth(ownerA).withBody({ firstName: 'Patrick', phone: person.phone, email: person.email }).expectSuccess();
  });
});
