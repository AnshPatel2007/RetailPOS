import { Response } from 'express';
import * as customerController from '../controllers/customer.controller';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import {
  createMockResponse,
  createMockNext,
} from './utils/testHelpers';
import {
  createRequestWithLocation,
  createCustomerForLocation,
  expectActivityLogHasLocation,
} from './utils/locationTestUtils';

// Mock Prisma
jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    customer: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    activityLog: {
      create: jest.fn(),
    },
  },
}));

describe('Customer Controller - Location Isolation Tests', () => {
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockResponse = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('getCustomer - Location Isolation', () => {
    it('should allow cashier to access customer from their own location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'CASHIER', {
        params: { id: 'customer-123' },
        query: {},
      });

      const mockCustomer = createCustomerForLocation('location-A', 'customer-123');
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(mockCustomer);

      await customerController.getCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify findFirst was called with location filter
      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'customer-123',
          locationId: 'location-A',
        },
        include: {
          sales: expect.any(Object),
        },
      });

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockCustomer,
        })
      );
    });

    it('should block cashier from accessing customer from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'CASHIER', {
        params: { id: 'customer-from-B' },
        query: {},
      });

      // Customer doesn't exist in location-A (simulating cross-location access block)
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        customerController.getCustomer(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Customer not found');

      // Verify findFirst was called with correct location filter
      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'customer-from-B',
          locationId: 'location-A',
        },
        include: expect.any(Object),
      });
    });

    it('should allow admin to access customer from any location', async () => {
      const mockRequest = createRequestWithLocation(null, 'ADMIN', {
        params: { id: 'customer-123' },
        query: { locationId: 'location-B' },
      });

      const mockCustomer = createCustomerForLocation('location-B', 'customer-123');
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(mockCustomer);

      await customerController.getCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Admin with explicit locationId in query
      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'customer-123',
          locationId: 'location-B',
        },
        include: expect.any(Object),
      });

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockCustomer,
        })
      );
    });

    it('should allow manager to access customer from their location only', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'customer-123' },
        query: {},
      });

      const mockCustomer = createCustomerForLocation('location-A', 'customer-123');
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(mockCustomer);

      await customerController.getCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'customer-123',
          locationId: 'location-A',
        },
        include: expect.any(Object),
      });
    });
  });

  describe('getCustomers - Pagination and Filtering', () => {
    it('should return only customers from user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'CASHIER', {
        query: { page: '1', limit: '10' },
      });

      const mockCustomers = [
        createCustomerForLocation('location-A', 'customer-1'),
        createCustomerForLocation('location-A', 'customer-2'),
      ];

      (prisma.customer.findMany as jest.Mock).mockResolvedValue(mockCustomers);
      (prisma.customer.count as jest.Mock).mockResolvedValue(2);

      await customerController.getCustomers(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify location filter was applied
      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            locationId: 'location-A',
          }),
        })
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockCustomers,
          pagination: expect.objectContaining({
            total: 2,
          }),
        })
      );
    });

    it('should filter by search term within user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'CASHIER', {
        query: { search: 'John', page: '1', limit: '10' },
      });

      const mockCustomers = [createCustomerForLocation('location-A', 'customer-1')];
      (prisma.customer.findMany as jest.Mock).mockResolvedValue(mockCustomers);
      (prisma.customer.count as jest.Mock).mockResolvedValue(1);

      await customerController.getCustomers(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify both search and location filters were applied
      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            locationId: 'location-A',
            OR: expect.any(Array),
          }),
        })
      );
    });
  });

  describe('createCustomer - Location Assignment', () => {
    it('should create customer with user locationId', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'CASHIER', {
        body: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '555-0123',
        },
      });

      const createdCustomer = createCustomerForLocation('location-A', 'new-customer-123');
      (prisma.customer.create as jest.Mock).mockResolvedValue(createdCustomer);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await customerController.createCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify customer was created with correct locationId
      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '555-0123',
          locationId: 'location-A',
        }),
      });

      // Verify activity log includes locationId
      expectActivityLogHasLocation(prisma.activityLog.create as jest.Mock, 'location-A');

      expect(mockResponse.status).toHaveBeenCalledWith(201);
    });

    it('should allow admin to create customer with explicit locationId', async () => {
      const mockRequest = createRequestWithLocation(null, 'ADMIN', {
        body: {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          locationId: 'location-B',
        },
      });

      const createdCustomer = createCustomerForLocation('location-B', 'new-customer-456');
      (prisma.customer.create as jest.Mock).mockResolvedValue(createdCustomer);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await customerController.createCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify customer was created with admin-specified locationId
      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          locationId: 'location-B',
        }),
      });
    });
  });

  describe('updateCustomer - Location Validation', () => {
    it('should allow update of customer in user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'CASHIER', {
        params: { id: 'customer-123' },
        body: {
          firstName: 'John Updated',
          phone: '555-9999',
        },
      });

      const existingCustomer = createCustomerForLocation('location-A', 'customer-123');
      const updatedCustomer = { ...existingCustomer, firstName: 'John Updated', phone: '555-9999' };

      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(existingCustomer);
      (prisma.customer.update as jest.Mock).mockResolvedValue(updatedCustomer);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await customerController.updateCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify findFirst was used with location filter
      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'customer-123',
          locationId: 'location-A',
        },
      });

      expect(prisma.customer.update).toHaveBeenCalled();
      expectActivityLogHasLocation(prisma.activityLog.create as jest.Mock, 'location-A');
    });

    it('should block update of customer from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'CASHIER', {
        params: { id: 'customer-from-B' },
        body: { firstName: 'Hacked' },
      });

      // Customer not found in user's location
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        customerController.updateCustomer(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Customer not found');

      // Verify update was never called
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteCustomer - Location Validation', () => {
    it('should allow delete of customer in user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'customer-123' },
      });

      const existingCustomer = createCustomerForLocation('location-A', 'customer-123');
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(existingCustomer);
      (prisma.customer.delete as jest.Mock).mockResolvedValue(existingCustomer);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await customerController.deleteCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify findFirst was used with location filter
      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'customer-123',
          locationId: 'location-A',
        },
      });

      expect(prisma.customer.delete).toHaveBeenCalledWith({
        where: { id: 'customer-123' },
      });

      expectActivityLogHasLocation(prisma.activityLog.create as jest.Mock, 'location-A');
    });

    it('should block delete of customer from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'customer-from-B' },
      });

      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        customerController.deleteCustomer(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Customer not found');

      expect(prisma.customer.delete).not.toHaveBeenCalled();
    });
  });

  describe('Activity Logs - LocationId Tracking', () => {
    it('should include locationId in all activity logs', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'CASHIER', {
        body: {
          firstName: 'Test',
          lastName: 'User',
          email: 'test@example.com',
        },
      });

      const createdCustomer = createCustomerForLocation('location-A');
      (prisma.customer.create as jest.Mock).mockResolvedValue(createdCustomer);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await customerController.createCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify activity log was created with locationId
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockRequest.user?.id,
          action: 'CREATE',
          entity: 'CUSTOMER',
          locationId: 'location-A',
        }),
      });
    });
  });
});
