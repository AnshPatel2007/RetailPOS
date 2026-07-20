import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';

// Mock Prisma
jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    product: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    inventoryLog: {
      create: jest.fn(),
    },
    activityLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  },
}));

// Import after mocking
import * as productController from '../controllers/product.controller';

describe('Product Controller', () => {
  let mockRequest: Partial<AuthRequest>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockRequest = {
      body: {},
      params: {},
      query: {},
      user: {
        id: '123',
        email: 'test@example.com',
        role: 'ADMIN',
        locationId: null,
      },
    };

    mockResponse = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();

    jest.clearAllMocks();
  });

  describe('getProducts', () => {
    const mockProducts = [
      {
        id: '1',
        sku: 'SKU001',
        name: 'Product 1',
        price: 10.99,
        stockQuantity: 100,
        category: { id: 'cat1', name: 'Category 1' },
        isActive: true,
      },
      {
        id: '2',
        sku: 'SKU002',
        name: 'Product 2',
        price: 20.99,
        stockQuantity: 50,
        category: null,
        isActive: true,
      },
    ];

    it('should return paginated list of products', async () => {
      mockRequest.query = { page: '1', limit: '10' };

      (prisma.product.findMany as jest.Mock).mockResolvedValue(mockProducts);
      (prisma.product.count as jest.Mock).mockResolvedValue(2);

      await productController.getProducts(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockProducts,
          pagination: expect.objectContaining({
            total: 2,
          }),
        })
      );
    });

    it('should filter products by category', async () => {
      mockRequest.query = { categoryId: 'cat1' };

      (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProducts[0]]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);

      await productController.getProducts(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            categoryId: 'cat1',
          }),
        })
      );
    });

    it('should search products by name or SKU', async () => {
      mockRequest.query = { search: 'Product 1' };

      (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProducts[0]]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);

      await productController.getProducts(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.product.findMany).toHaveBeenCalled();
    });
  });

  describe('getProduct', () => {
    const mockProduct = {
      id: '1',
      sku: 'SKU001',
      name: 'Product 1',
      price: 10.99,
      stockQuantity: 100,
      category: { id: 'cat1', name: 'Category 1' },
      variants: [],
      inventoryLogs: [],
    };

    it('should return a single product by ID', async () => {
      mockRequest.params = { id: '1' };

      (prisma.product.findUnique as jest.Mock).mockResolvedValue(mockProduct);

      await productController.getProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.product.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '1' },
        })
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockProduct,
        })
      );
    });

    it('should return 404 if product not found', async () => {
      mockRequest.params = { id: 'nonexistent' };

      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);

      await productController.getProduct(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        );
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Product not found' })
      );
    });
  });

  describe('createProduct', () => {
    it('should create a new product', async () => {
      mockRequest.body = {
        sku: 'SKU003',
        name: 'New Product',
        price: 15.99,
        cost: 10.00,
        stockQuantity: 50,
        categoryId: 'cat1',
      };

      const createdProduct = {
        id: '3',
        ...mockRequest.body,
      };

      (prisma.product.create as jest.Mock).mockResolvedValue(createdProduct);

      await productController.createProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.product.create).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: createdProduct,
        })
      );
    });
  });

  describe('updateProduct', () => {
    it('should update an existing product', async () => {
      mockRequest.params = { id: '1' };
      mockRequest.body = {
        name: 'Updated Product',
        price: 25.99,
      };

      const existingProduct = {
        id: '1',
        sku: 'SKU001',
        name: 'Original Product',
        price: 10.99,
      };

      const updatedProduct = {
        ...existingProduct,
        ...mockRequest.body,
      };

      (prisma.product.findUnique as jest.Mock).mockResolvedValue(existingProduct);
      (prisma.product.update as jest.Mock).mockResolvedValue(updatedProduct);

      await productController.updateProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: updatedProduct,
        })
      );
    });
  });

  describe('deleteProduct', () => {
    it('should delete a product', async () => {
      mockRequest.params = { id: '1' };

      (prisma.product.findUnique as jest.Mock).mockResolvedValue({ id: '1' });
      (prisma.product.delete as jest.Mock).mockResolvedValue({ id: '1' });

      await productController.deleteProduct(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.product.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Product deleted successfully',
        })
      );
    });
  });

  describe('getLowStockProducts', () => {
    it('should return products with low stock', async () => {
      const lowStockProducts = [
        {
          id: '1',
          name: 'Low Stock Product',
          stockQuantity: 5,
          lowStockAlert: 10,
        },
      ];

      // getLowStockProducts uses raw SQL (field-to-field comparison)
      (prisma.$queryRaw as jest.Mock).mockResolvedValue(lowStockProducts);

      await productController.getLowStockProducts(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: lowStockProducts,
        })
      );
    });
  });
});
