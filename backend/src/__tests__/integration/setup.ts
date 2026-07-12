/**
 * Integration Test Setup
 *
 * Sets up the test environment for integration tests with:
 * - Real database connection (MUST be a dedicated test database)
 * - Database cleanup between tests
 * - Test data seeding
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { resolveDatabaseUrl } from '../../config/database';

// Same resolution as the app under test: DATABASE_URL_TEST, or the dev URL
// with a "_test" suffix on the database name (jest sets NODE_ENV=test)
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: resolveDatabaseUrl(),
    },
  },
});

/**
 * Clean database — truncates every table in the public schema except the
 * Prisma migrations table. Discovering tables dynamically keeps this in
 * sync with the schema automatically.
 */
export async function cleanDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const tableList = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
}

/**
 * Seed test data - creates minimal data for testing
 */
export interface TestData {
  location: any;
  adminUser: any;
  cashierUser: any;
  category: any;
  supplier: any;
  customer: any;
  product: any;
  taxRate: any;
}

export async function seedTestData(): Promise<TestData> {
  // Create location
  const location = await prisma.location.create({
    data: {
      id: 'test-location-1',
      name: 'Test Store',
      address: '123 Test St',
      city: 'Test City',
      state: 'TS',
      zipCode: '12345',
      phone: '555-0001',
      email: 'test@store.com',
      isActive: true,
    },
  });

  // Create admin user
  const hashedPassword = await bcrypt.hash('Admin123!', 10);
  const adminUser = await prisma.user.create({
    data: {
      id: 'test-admin-1',
      email: 'admin@test.com',
      password: hashedPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      locationId: location.id,
      isActive: true,
    },
  });

  // Create cashier user
  const cashierUser = await prisma.user.create({
    data: {
      id: 'test-cashier-1',
      email: 'cashier@test.com',
      password: hashedPassword,
      firstName: 'Cashier',
      lastName: 'User',
      role: 'CASHIER',
      locationId: location.id,
      isActive: true,
    },
  });

  // Create category
  const category = await prisma.category.create({
    data: {
      id: 'test-category-1',
      name: 'Test Category',
      description: 'Category for testing',
    },
  });

  // Create supplier
  const supplier = await prisma.supplier.create({
    data: {
      id: 'test-supplier-1',
      name: 'Test Supplier',
      email: 'supplier@test.com',
      phone: '555-0002',
      address: '456 Supplier St',
    },
  });

  // Create customer (auto-generated UUID — the sale API validates customerId as uuid)
  const customer = await prisma.customer.create({
    data: {
      email: 'customer@test.com',
      firstName: 'Test',
      lastName: 'Customer',
      phone: '555-0003',
    },
  });

  // Create product
  const product = await prisma.product.create({
    data: {
      id: 'test-product-1',
      name: 'Test Product',
      sku: 'TEST-SKU-001',
      barcode: '1234567890',
      price: 19.99,
      cost: 10.0,
      stockQuantity: 100,
      categoryId: category.id,
      locationId: location.id,
      isActive: true,
    },
  });

  // Default tax rate (sales tax math depends on it)
  const taxRate = await prisma.taxRate.create({
    data: {
      name: 'Test Tax',
      rate: 10,
      isDefault: true,
      isActive: true,
    },
  });

  return {
    location,
    adminUser,
    cashierUser,
    category,
    supplier,
    customer,
    product,
    taxRate,
  };
}

/**
 * Close database connection
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Global test setup
 */
beforeAll(async () => {
  // Ensure we're using test database — these tests TRUNCATE every table
  const url = resolveDatabaseUrl() || '';
  if (!url.includes('test')) {
    throw new Error(
      'Integration tests must use a test database! Set DATABASE_URL_TEST environment variable.'
    );
  }
});

/**
 * Clean database before each test
 */
beforeEach(async () => {
  await cleanDatabase();
});

/**
 * Close connection after all tests
 */
afterAll(async () => {
  await disconnectDatabase();
});
