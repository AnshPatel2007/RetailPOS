/**
 * Location Isolation Test Utilities
 *
 * These utilities help test location-based data isolation
 * to ensure users can only access data from their assigned location.
 */

import { AuthRequest } from '../../types';

/**
 * Creates a user with specific location for testing
 */
export const createUserWithLocation = (locationId: string | null, role: string = 'CASHIER') => {
  return {
    id: `user-${locationId}`,
    email: `test-${locationId}@example.com`,
    role,
    locationId,
  };
};

/**
 * Creates an admin user (can access all locations)
 */
export const createAdminUser = () => {
  return {
    id: 'admin-123',
    email: 'admin@example.com',
    role: 'ADMIN',
    locationId: null,
  };
};

/**
 * Creates a manager user with location
 */
export const createManagerUser = (locationId: string) => {
  return {
    id: `manager-${locationId}`,
    email: `manager-${locationId}@example.com`,
    role: 'MANAGER',
    locationId,
  };
};

/**
 * Creates a request object with specific user location
 */
export const createRequestWithLocation = (
  locationId: string | null,
  role: string = 'CASHIER',
  overrides?: Partial<AuthRequest>
): Partial<AuthRequest> => {
  return {
    body: {},
    params: {},
    query: {},
    user: createUserWithLocation(locationId, role) as any,
    ...overrides,
  };
};

/**
 * Test data factories for different locations
 */

export const createCustomerForLocation = (locationId: string, customerId?: string) => {
  return {
    id: customerId || `customer-${locationId}-1`,
    firstName: 'John',
    lastName: 'Doe',
    email: `john.${locationId}@example.com`,
    phone: '555-0123',
    locationId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
};

export const createProductForLocation = (locationId: string, productId?: string) => {
  return {
    id: productId || `product-${locationId}-1`,
    sku: `SKU-${locationId}-001`,
    name: `Product for ${locationId}`,
    price: 10.99,
    cost: 5.00,
    stockQuantity: 100,
    locationId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
};

export const createSupplierForLocation = (locationId: string, supplierId?: string) => {
  return {
    id: supplierId || `supplier-${locationId}-1`,
    name: `Supplier for ${locationId}`,
    contactName: 'Jane Smith',
    email: `supplier.${locationId}@example.com`,
    phone: '555-0456',
    locationId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
};

export const createPurchaseOrderForLocation = (locationId: string, supplierId: string, orderId?: string) => {
  return {
    id: orderId || `po-${locationId}-1`,
    orderNumber: `PO-${locationId}-001`,
    supplierId,
    locationId,
    status: 'PENDING',
    orderDate: new Date(),
    totalAmount: 100.00,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
};

/**
 * Location isolation test scenarios
 */

export interface LocationIsolationTestScenario {
  name: string;
  userLocation: string | null;
  userRole: string;
  resourceLocation: string;
  shouldHaveAccess: boolean;
}

/**
 * Standard location isolation test scenarios
 */
export const LOCATION_ISOLATION_SCENARIOS: LocationIsolationTestScenario[] = [
  {
    name: 'Cashier accessing own location data',
    userLocation: 'location-A',
    userRole: 'CASHIER',
    resourceLocation: 'location-A',
    shouldHaveAccess: true,
  },
  {
    name: 'Cashier accessing different location data',
    userLocation: 'location-A',
    userRole: 'CASHIER',
    resourceLocation: 'location-B',
    shouldHaveAccess: false,
  },
  {
    name: 'Manager accessing own location data',
    userLocation: 'location-A',
    userRole: 'MANAGER',
    resourceLocation: 'location-A',
    shouldHaveAccess: true,
  },
  {
    name: 'Manager accessing different location data',
    userLocation: 'location-A',
    userRole: 'MANAGER',
    resourceLocation: 'location-B',
    shouldHaveAccess: false,
  },
  {
    name: 'Admin accessing any location data',
    userLocation: null,
    userRole: 'ADMIN',
    resourceLocation: 'location-A',
    shouldHaveAccess: true,
  },
];

/**
 * Validates location filter was applied correctly
 */
export const expectLocationFilterApplied = (
  mockFunction: jest.Mock,
  expectedLocation: string | null
) => {
  const calls = mockFunction.mock.calls;
  expect(calls.length).toBeGreaterThan(0);

  const lastCall = calls[calls.length - 1][0];

  if (expectedLocation === null) {
    // Admin should not have location filter
    expect(lastCall.where.locationId).toBeUndefined();
  } else {
    // Non-admin should have location filter
    expect(lastCall.where.locationId).toBe(expectedLocation);
  }
};

/**
 * Validates cross-location access is blocked
 */
export const expectCrossLocationAccessBlocked = (result: any) => {
  expect(result).toBeNull();
};

/**
 * Validates activity log includes locationId
 */
export const expectActivityLogHasLocation = (
  activityLogMock: jest.Mock,
  expectedLocationId: string | null
) => {
  expect(activityLogMock).toHaveBeenCalled();
  const createCall = activityLogMock.mock.calls[0][0];
  expect(createCall.data.locationId).toBe(expectedLocationId);
};
