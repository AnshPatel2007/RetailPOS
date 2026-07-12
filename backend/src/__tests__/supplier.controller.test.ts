import { Response } from 'express';
import * as supplierController from '../controllers/supplier.controller';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { createMockResponse, createMockNext, createMockAuthRequest } from './utils/testHelpers';

// Mock Prisma
jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    supplier: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
    },
    productSupplier: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    purchaseOrder: {
      findMany: jest.fn(),
    },
  },
}));

const mockSupplier = {
  id: 'supplier-123',
  name: 'Test Supplier',
  contactName: 'Jane Smith',
  email: 'supplier@example.com',
  phone: '555-0456',
  address: '123 Supplier St',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Supplier Controller', () => {
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockResponse = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('getSuppliers', () => {
    it('should return paginated suppliers with counts', async () => {
      const mockRequest = createMockAuthRequest({ query: { page: '1', limit: '20' } });

      (prisma.supplier.findMany as jest.Mock).mockResolvedValue([mockSupplier]);
      (prisma.supplier.count as jest.Mock).mockResolvedValue(1);

      await supplierController.getSuppliers(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({ _count: expect.any(Object) }),
          skip: 0,
          take: 20,
        })
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: [mockSupplier],
          pagination: expect.objectContaining({ total: 1 }),
        })
      );
    });

    it('should filter by active status', async () => {
      const mockRequest = createMockAuthRequest({ query: { isActive: 'true' } });

      (prisma.supplier.findMany as jest.Mock).mockResolvedValue([mockSupplier]);
      (prisma.supplier.count as jest.Mock).mockResolvedValue(1);

      await supplierController.getSuppliers(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        })
      );
    });
  });

  describe('getSupplier', () => {
    it('should return supplier with products and recent purchase orders', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'supplier-123' } });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue({
        ...mockSupplier,
        products: [],
        purchaseOrders: [],
      });

      await supplierController.getSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'supplier-123' } })
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should error when supplier not found', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'nonexistent' } });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(null);

      await supplierController.getSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Supplier not found', statusCode: 404 })
      );
    });
  });

  describe('createSupplier', () => {
    it('should create a supplier', async () => {
      const mockRequest = createMockAuthRequest({
        body: { name: 'New Supplier', email: 'new@supplier.com' },
      });

      (prisma.supplier.create as jest.Mock).mockResolvedValue(mockSupplier);

      await supplierController.createSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'New Supplier', email: 'new@supplier.com' }),
      });
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Supplier created successfully' })
      );
    });
  });

  describe('updateSupplier', () => {
    it('should update an existing supplier', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'supplier-123' },
        body: { name: 'Renamed Supplier' },
      });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.supplier.update as jest.Mock).mockResolvedValue({
        ...mockSupplier,
        name: 'Renamed Supplier',
      });

      await supplierController.updateSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'supplier-123' } })
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Supplier updated successfully' })
      );
    });

    it('should error when updating a missing supplier', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'nonexistent' },
        body: { name: 'Ghost' },
      });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(null);

      await supplierController.updateSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Supplier not found' })
      );
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteSupplier', () => {
    it('should delete a supplier with no purchase orders', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'supplier-123' } });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue({
        ...mockSupplier,
        _count: { purchaseOrders: 0 },
      });
      (prisma.supplier.delete as jest.Mock).mockResolvedValue(mockSupplier);

      await supplierController.deleteSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.supplier.delete).toHaveBeenCalledWith({ where: { id: 'supplier-123' } });
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Supplier deleted successfully' })
      );
    });

    it('should block deleting a supplier with purchase orders', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'supplier-123' } });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue({
        ...mockSupplier,
        _count: { purchaseOrders: 3 },
      });

      await supplierController.deleteSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Cannot delete supplier with existing purchase orders'),
        })
      );
      expect(prisma.supplier.delete).not.toHaveBeenCalled();
    });

    it('should error when deleting a missing supplier', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'nonexistent' } });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(null);

      await supplierController.deleteSupplier(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Supplier not found' })
      );
    });
  });

  describe('linkProduct', () => {
    const linkBody = { productId: 'product-123', cost: 5.0 };

    it('should link a product to a supplier', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'supplier-123' },
        body: linkBody,
      });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.product.findUnique as jest.Mock).mockResolvedValue({ id: 'product-123' });
      (prisma.productSupplier.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.productSupplier.create as jest.Mock).mockResolvedValue({
        id: 'link-1',
        productId: 'product-123',
        supplierId: 'supplier-123',
      });

      await supplierController.linkProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.productSupplier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'product-123',
            supplierId: 'supplier-123',
          }),
        })
      );
      expect(mockResponse.status).toHaveBeenCalledWith(201);
    });

    it('should error when supplier is missing', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'nonexistent' },
        body: linkBody,
      });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(null);

      await supplierController.linkProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Supplier not found' })
      );
    });

    it('should error when product is missing', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'supplier-123' },
        body: linkBody,
      });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);

      await supplierController.linkProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Product not found' })
      );
    });

    it('should reject duplicate links', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'supplier-123' },
        body: linkBody,
      });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.product.findUnique as jest.Mock).mockResolvedValue({ id: 'product-123' });
      (prisma.productSupplier.findUnique as jest.Mock).mockResolvedValue({ id: 'existing-link' });

      await supplierController.linkProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Product is already linked to this supplier' })
      );
      expect(prisma.productSupplier.create).not.toHaveBeenCalled();
    });
  });

  describe('unlinkProduct', () => {
    it('should unlink a product from a supplier', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'supplier-123', productId: 'product-123' },
      });

      (prisma.productSupplier.findUnique as jest.Mock).mockResolvedValue({ id: 'link-1' });
      (prisma.productSupplier.delete as jest.Mock).mockResolvedValue({});

      await supplierController.unlinkProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.productSupplier.delete).toHaveBeenCalledWith({
        where: {
          productId_supplierId: {
            productId: 'product-123',
            supplierId: 'supplier-123',
          },
        },
      });
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should error when the link does not exist', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'supplier-123', productId: 'product-999' },
      });

      (prisma.productSupplier.findUnique as jest.Mock).mockResolvedValue(null);

      await supplierController.unlinkProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Product-supplier link not found' })
      );
      expect(prisma.productSupplier.delete).not.toHaveBeenCalled();
    });
  });
});
