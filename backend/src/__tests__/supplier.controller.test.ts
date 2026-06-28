import { Response } from 'express';
import * as supplierController from '../controllers/supplier.controller';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import {
  createMockResponse,
  createMockNext,
} from './utils/testHelpers';
import {
  createRequestWithLocation,
  createSupplierForLocation,
  createProductForLocation,
  expectActivityLogHasLocation,
} from './utils/locationTestUtils';

// Mock Prisma
jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    supplier: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    activityLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

describe('Supplier Controller - Location Isolation Tests', () => {
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockResponse = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('getSupplier - Location Isolation', () => {
    it('should allow user to access supplier from their location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'supplier-123' },
        query: {},
      });

      const mockSupplier = createSupplierForLocation('location-A', 'supplier-123');
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(mockSupplier);

      await supplierController.getSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify findFirst was called with location filter
      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'supplier-123',
          locationId: 'location-A',
        },
        include: {
          products: expect.any(Object),
          purchaseOrders: expect.any(Object),
        },
      });

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockSupplier,
        })
      );
    });

    it('should block access to supplier from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'supplier-from-B' },
        query: {},
      });

      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        supplierController.getSupplier(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Supplier not found');

      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'supplier-from-B',
          locationId: 'location-A',
        },
        include: expect.any(Object),
      });
    });

    it('should allow admin to access supplier with explicit locationId', async () => {
      const mockRequest = createRequestWithLocation(null, 'ADMIN', {
        params: { id: 'supplier-123' },
        query: { locationId: 'location-B' },
      });

      const mockSupplier = createSupplierForLocation('location-B', 'supplier-123');
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(mockSupplier);

      await supplierController.getSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'supplier-123',
          locationId: 'location-B',
        },
        include: expect.any(Object),
      });
    });
  });

  describe('getSuppliers - Filtering and Pagination', () => {
    it('should return only suppliers from user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'CASHIER', {
        query: { page: '1', limit: '10' },
      });

      const mockSuppliers = [
        createSupplierForLocation('location-A', 'supplier-1'),
        createSupplierForLocation('location-A', 'supplier-2'),
      ];

      (prisma.supplier.findMany as jest.Mock).mockResolvedValue(mockSuppliers);
      (prisma.supplier.count as jest.Mock).mockResolvedValue(2);

      await supplierController.getSuppliers(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            locationId: 'location-A',
          }),
        })
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockSuppliers,
        })
      );
    });

    it('should filter by active status within user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        query: { isActive: 'true', page: '1', limit: '10' },
      });

      const activeSuppliers = [createSupplierForLocation('location-A', 'supplier-1')];
      (prisma.supplier.findMany as jest.Mock).mockResolvedValue(activeSuppliers);
      (prisma.supplier.count as jest.Mock).mockResolvedValue(1);

      await supplierController.getSuppliers(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            locationId: 'location-A',
            isActive: true,
          }),
        })
      );
    });
  });

  describe('createSupplier - Location Assignment', () => {
    it('should create supplier with user locationId', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        body: {
          name: 'New Supplier',
          contactName: 'John Smith',
          email: 'supplier@example.com',
          phone: '555-0123',
        },
      });

      const createdSupplier = createSupplierForLocation('location-A', 'new-supplier-123');
      (prisma.supplier.create as jest.Mock).mockResolvedValue(createdSupplier);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await supplierController.createSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'New Supplier',
          locationId: 'location-A',
        }),
      });

      expectActivityLogHasLocation(prisma.activityLog.create as jest.Mock, 'location-A');
      expect(mockResponse.status).toHaveBeenCalledWith(201);
    });

    it('should allow admin to create supplier with explicit locationId', async () => {
      const mockRequest = createRequestWithLocation(null, 'ADMIN', {
        body: {
          name: 'Admin Supplier',
          contactName: 'Jane Doe',
          email: 'admin.supplier@example.com',
          locationId: 'location-B',
        },
      });

      const createdSupplier = createSupplierForLocation('location-B', 'new-supplier-456');
      (prisma.supplier.create as jest.Mock).mockResolvedValue(createdSupplier);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await supplierController.createSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          locationId: 'location-B',
        }),
      });
    });
  });

  describe('updateSupplier - Location Validation', () => {
    it('should allow update of supplier in user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'supplier-123' },
        body: {
          name: 'Updated Supplier',
          phone: '555-9999',
        },
      });

      const existingSupplier = createSupplierForLocation('location-A', 'supplier-123');
      const updatedSupplier = { ...existingSupplier, name: 'Updated Supplier', phone: '555-9999' };

      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(existingSupplier);
      (prisma.supplier.update as jest.Mock).mockResolvedValue(updatedSupplier);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await supplierController.updateSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'supplier-123',
          locationId: 'location-A',
        },
      });

      expect(prisma.supplier.update).toHaveBeenCalled();
      expectActivityLogHasLocation(prisma.activityLog.create as jest.Mock, 'location-A');
    });

    it('should block update of supplier from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'supplier-from-B' },
        body: { name: 'Hacked' },
      });

      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        supplierController.updateSupplier(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Supplier not found');

      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteSupplier - Location Validation', () => {
    it('should allow delete of supplier in user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'ADMIN', {
        params: { id: 'supplier-123' },
      });

      const existingSupplier = createSupplierForLocation('location-A', 'supplier-123');
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(existingSupplier);
      (prisma.supplier.delete as jest.Mock).mockResolvedValue(existingSupplier);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await supplierController.deleteSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'supplier-123',
          locationId: 'location-A',
        },
      });

      expect(prisma.supplier.delete).toHaveBeenCalledWith({
        where: { id: 'supplier-123' },
      });
    });

    it('should block delete of supplier from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'ADMIN', {
        params: { id: 'supplier-from-B' },
      });

      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        supplierController.deleteSupplier(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Supplier not found');

      expect(prisma.supplier.delete).not.toHaveBeenCalled();
    });
  });

  describe('linkProduct - Cross-Entity Location Validation', () => {
    it('should allow linking product and supplier from same location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'supplier-123', productId: 'product-456' },
      });

      const mockSupplier = createSupplierForLocation('location-A', 'supplier-123');
      const mockProduct = createProductForLocation('location-A', 'product-456');

      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.product.findFirst as jest.Mock).mockResolvedValue(mockProduct);
      (prisma.product.update as jest.Mock).mockResolvedValue({
        ...mockProduct,
        suppliers: [mockSupplier],
      });
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await supplierController.linkProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify both supplier and product were validated for location
      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'supplier-123',
          locationId: 'location-A',
        },
      });

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'product-456',
          locationId: 'location-A',
        },
      });

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Product linked to supplier successfully',
        })
      );
    });

    it('should block linking if supplier is from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'supplier-from-B', productId: 'product-456' },
      });

      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        supplierController.linkProduct(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Supplier not found');

      // Verify product lookup was never attempted
      expect(prisma.product.findFirst).not.toHaveBeenCalled();
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('should block linking if product is from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'supplier-123', productId: 'product-from-B' },
      });

      const mockSupplier = createSupplierForLocation('location-A', 'supplier-123');
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.product.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        supplierController.linkProduct(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Product not found');

      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });

  describe('unlinkProduct - Cross-Entity Location Validation', () => {
    it('should allow unlinking product and supplier from same location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'supplier-123', productId: 'product-456' },
      });

      const mockSupplier = createSupplierForLocation('location-A', 'supplier-123');
      const mockProduct = createProductForLocation('location-A', 'product-456');

      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.product.findFirst as jest.Mock).mockResolvedValue(mockProduct);
      (prisma.product.update as jest.Mock).mockResolvedValue(mockProduct);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await supplierController.unlinkProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'supplier-123',
          locationId: 'location-A',
        },
      });

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'product-456',
          locationId: 'location-A',
        },
      });
    });

    it('should block unlinking if entities are from different locations', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'supplier-from-B', productId: 'product-456' },
      });

      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        supplierController.unlinkProduct(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Supplier not found');
    });
  });
});
