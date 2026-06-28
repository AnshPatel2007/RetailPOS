import { Response } from 'express';
import { AuthRequest } from '../../types';

/**
 * Creates a mock Express Request object with authentication
 */
export const createMockAuthRequest = (overrides?: Partial<AuthRequest>): Partial<AuthRequest> => {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    ip: '127.0.0.1',
    cookies: {},
    user: {
      id: 'user-123',
      email: 'test@example.com',
      role: 'CASHIER',
      locationId: 'location-123',
    },
    ...overrides,
  };
};

/**
 * Creates a mock Express Response object
 */
export const createMockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    sendStatus: jest.fn().mockReturnThis(),
  };
  return res;
};

/**
 * Creates a mock Next function
 */
export const createMockNext = (): jest.Mock => {
  return jest.fn();
};

/**
 * Mock user factory
 */
export const createMockUser = (overrides?: any) => {
  return {
    id: 'user-123',
    email: 'test@example.com',
    password: 'hashedPassword',
    firstName: 'Test',
    lastName: 'User',
    role: 'CASHIER',
    isActive: true,
    twoFactorEnabled: false,
    failedLoginAttempts: 0,
    lockoutUntil: null,
    locationId: 'location-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    location: null,
    ...overrides,
  };
};

/**
 * Mock customer factory
 */
export const createMockCustomer = (overrides?: any) => {
  return {
    id: 'customer-123',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    phone: '555-0123',
    loyaltyPoints: 100,
    totalSpent: 500.00,
    visitCount: 5,
    locationId: 'location-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
};

/**
 * Mock product factory
 */
export const createMockProduct = (overrides?: any) => {
  return {
    id: 'product-123',
    sku: 'SKU001',
    name: 'Test Product',
    description: 'Test product description',
    price: 10.99,
    cost: 5.00,
    stockQuantity: 100,
    lowStockAlert: 10,
    categoryId: 'category-123',
    locationId: 'location-123',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
};

/**
 * Mock supplier factory
 */
export const createMockSupplier = (overrides?: any) => {
  return {
    id: 'supplier-123',
    name: 'Test Supplier',
    contactName: 'Jane Smith',
    email: 'supplier@example.com',
    phone: '555-0456',
    address: '123 Supplier St',
    locationId: 'location-123',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
};

/**
 * Mock purchase order factory
 */
export const createMockPurchaseOrder = (overrides?: any) => {
  return {
    id: 'po-123',
    orderNumber: 'PO-001',
    supplierId: 'supplier-123',
    locationId: 'location-123',
    status: 'PENDING',
    orderDate: new Date(),
    expectedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    totalAmount: 100.00,
    notes: 'Test order',
    createdById: 'user-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
};

/**
 * Mock category factory
 */
export const createMockCategory = (overrides?: any) => {
  return {
    id: 'category-123',
    name: 'Test Category',
    description: 'Test category description',
    locationId: 'location-123',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
};

/**
 * Extracts error message from caught error
 */
export const extractErrorMessage = (error: any): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
};

/**
 * Expects an async function to throw with a specific message
 */
export const expectAsyncThrow = async (
  fn: () => Promise<any>,
  expectedMessage: string | RegExp
): Promise<void> => {
  try {
    await fn();
    throw new Error('Expected function to throw, but it did not');
  } catch (error) {
    const message = extractErrorMessage(error);
    if (typeof expectedMessage === 'string') {
      expect(message).toBe(expectedMessage);
    } else {
      expect(message).toMatch(expectedMessage);
    }
  }
};
