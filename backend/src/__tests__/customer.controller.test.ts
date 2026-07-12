import { Response } from 'express';
import * as customerController from '../controllers/customer.controller';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { createMockResponse, createMockNext, createMockAuthRequest } from './utils/testHelpers';

// Mock Prisma
jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    customer: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    sale: {
      findMany: jest.fn(),
    },
    activityLog: {
      create: jest.fn(),
    },
  },
}));

const mockCustomer = {
  id: 'customer-123',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@example.com',
  phone: '555-0123',
  loyaltyPoints: 100,
  loyaltyTier: 'BRONZE',
  totalSpent: 500.0,
  visitCount: 5,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Customer Controller', () => {
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockResponse = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('getCustomers', () => {
    it('should return paginated active customers', async () => {
      const mockRequest = createMockAuthRequest({ query: { page: '1', limit: '10' } });

      (prisma.customer.findMany as jest.Mock).mockResolvedValue([mockCustomer]);
      (prisma.customer.count as jest.Mock).mockResolvedValue(1);

      await customerController.getCustomers(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Only active customers are listed
      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
          skip: 0,
          take: 10,
        })
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: [mockCustomer],
          pagination: expect.objectContaining({ total: 1, page: 1 }),
        })
      );
    });

    it('should filter by search term across name, email, and phone', async () => {
      const mockRequest = createMockAuthRequest({ query: { search: 'John' } });

      (prisma.customer.findMany as jest.Mock).mockResolvedValue([mockCustomer]);
      (prisma.customer.count as jest.Mock).mockResolvedValue(1);

      await customerController.getCustomers(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            OR: expect.arrayContaining([
              expect.objectContaining({ firstName: expect.anything() }),
              expect.objectContaining({ phone: expect.anything() }),
            ]),
          }),
        })
      );
    });
  });

  describe('getCustomer', () => {
    it('should return customer with recent sales', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'customer-123' } });

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({
        ...mockCustomer,
        sales: [],
      });

      await customerController.getCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.customer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'customer-123' },
          include: expect.objectContaining({ sales: expect.any(Object) }),
        })
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should error when customer not found', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'nonexistent' } });

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);

      await customerController.getCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Customer not found', statusCode: 404 })
      );
    });
  });

  describe('createCustomer', () => {
    it('should create customer and log activity', async () => {
      const mockRequest = createMockAuthRequest({
        body: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '555-0123',
        },
      });

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null); // email check
      (prisma.customer.create as jest.Mock).mockResolvedValue(mockCustomer);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await customerController.createCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ firstName: 'John', email: 'john@example.com' }),
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'CREATE', entity: 'CUSTOMER' }),
      });
      expect(mockResponse.status).toHaveBeenCalledWith(201);
    });

    it('should reject duplicate email', async () => {
      const mockRequest = createMockAuthRequest({
        body: { firstName: 'Jane', lastName: 'Doe', email: 'taken@example.com' },
      });

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);

      await customerController.createCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Customer with this email already exists' })
      );
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });
  });

  describe('updateCustomer', () => {
    it('should update an existing customer', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'customer-123' },
        body: { firstName: 'John Updated' },
      });

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);
      (prisma.customer.update as jest.Mock).mockResolvedValue({
        ...mockCustomer,
        firstName: 'John Updated',
      });
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await customerController.updateCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'customer-123' },
          data: expect.objectContaining({ firstName: 'John Updated' }),
        })
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Customer updated successfully' })
      );
    });

    it('should error when updating a missing customer', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'nonexistent' },
        body: { firstName: 'Ghost' },
      });

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);

      await customerController.updateCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Customer not found' })
      );
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('should reject email change to an address already in use', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'customer-123' },
        body: { email: 'taken@example.com' },
      });

      (prisma.customer.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockCustomer) // target customer
        .mockResolvedValueOnce({ id: 'other-customer' }); // email owner

      await customerController.updateCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Customer with this email already exists' })
      );
    });
  });

  describe('deleteCustomer', () => {
    it('should soft-delete by setting isActive false', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'customer-123' } });

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);
      (prisma.customer.update as jest.Mock).mockResolvedValue({ ...mockCustomer, isActive: false });
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await customerController.deleteCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Soft delete — never a hard delete
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-123' },
        data: { isActive: false },
      });
      expect(prisma.customer.delete).not.toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Customer deleted successfully' })
      );
    });

    it('should error when deleting a missing customer', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'nonexistent' } });

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);

      await customerController.deleteCustomer(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Customer not found' })
      );
    });
  });

  describe('getCustomerHistory', () => {
    it('should return the customer purchase history', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'customer-123' } });
      const mockSales = [{ id: 'sale-1', total: 25, items: [], user: {} }];

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);
      (prisma.sale.findMany as jest.Mock).mockResolvedValue(mockSales);

      await customerController.getCustomerHistory(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerId: 'customer-123' } })
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: mockSales })
      );
    });

    it('should error when customer not found', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'nonexistent' } });

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);

      await customerController.getCustomerHistory(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Customer not found' })
      );
    });
  });
});
