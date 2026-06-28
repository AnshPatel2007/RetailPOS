/**
 * Integration Test Setup
 *
 * Sets up the test environment for integration tests with:
 * - Real database connection
 * - Database cleanup between tests
 * - Test data seeding
 * - Authentication helpers
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
    },
  },
});

/**
 * Clean database - removes all data from tables
 * Order matters due to foreign key constraints
 */
export async function cleanDatabase(): Promise<void> {
  const tablenames = [
    'ActivityLog',
    'SaleItem',
    'Sale',
    'LayawayPayment',
    'Layaway',
    'PurchaseOrderItem',
    'PurchaseOrder',
    'Product',
    'Category',
    'Supplier',
    'Customer',
    'Shift',
    'User',
    'Location',
    'TaxRate',
    'DiscountRule',
  ];

  try {
    // Delete in order to avoid foreign key constraint violations
    for (const tablename of tablenames) {
      try {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
      } catch (error) {
        // Table might not exist or already be empty
        console.warn(`Could not truncate ${tablename}:`, error);
      }
    }
  } catch (error) {
    console.error('Error cleaning database:', error);
    throw error;
  }
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
      timezone: 'America/New_York',
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
      locationId: location.id,
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
      city: 'Supplier City',
      state: 'SS',
      zipCode: '54321',
      locationId: location.id,
    },
  });

  // Create customer
  const customer = await prisma.customer.create({
    data: {
      id: 'test-customer-1',
      email: 'customer@test.com',
      firstName: 'Test',
      lastName: 'Customer',
      phone: '555-0003',
      locationId: location.id,
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
      cost: 10.00,
      quantity: 100,
      categoryId: category.id,
      supplierId: supplier.id,
      locationId: location.id,
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
  // Ensure we're using test database
  if (!process.env.DATABASE_URL_TEST && !process.env.DATABASE_URL?.includes('test')) {
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
