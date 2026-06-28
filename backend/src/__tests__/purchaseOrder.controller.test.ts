import { Response } from 'express';
import * as purchaseOrderController from '../controllers/purchaseOrder.controller';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import {
  createMockResponse,
  createMockNext,
} from './utils/testHelpers';
import {
  createRequestWithLocation,
  createPurchaseOrderForLocation,
  createSupplierForLocation,
  createProductForLocation,
  expectActivityLogHasLocation,
} from './utils/locationTestUtils';

// Mock Prisma
jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    purchaseOrder: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    supplier: {
      findFirst: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    inventoryLog: {
      create: jest.fn(),
    },
    activityLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

describe('Purchase Order Controller - Location Isolation Tests', () => {
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockResponse = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('getPurchaseOrder - Location Isolation', () => {
    it('should allow user to access purchase order from their location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'po-123' },
        query: {},
      });

      const mockPO = createPurchaseOrderForLocation('location-A', 'supplier-123', 'po-123');
      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(mockPO);

      await purchaseOrderController.getPurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'po-123',
          locationId: 'location-A',
        },
        include: {
          supplier: true,
          items: expect.any(Object),
          createdBy: expect.any(Object),
        },
      });

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockPO,
        })
      );
    });

    it('should block access to purchase order from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'po-from-B' },
        query: {},
      });

      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        purchaseOrderController.getPurchaseOrder(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Purchase order not found');
    });

    it('should allow admin to access PO with explicit locationId', async () => {
      const mockRequest = createRequestWithLocation(null, 'ADMIN', {
        params: { id: 'po-123' },
        query: { locationId: 'location-B' },
      });

      const mockPO = createPurchaseOrderForLocation('location-B', 'supplier-456', 'po-123');
      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(mockPO);

      await purchaseOrderController.getPurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'po-123',
          locationId: 'location-B',
        },
        include: expect.any(Object),
      });
    });
  });

  describe('getPurchaseOrders - Filtering and Pagination', () => {
    it('should return only purchase orders from user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'CASHIER', {
        query: { page: '1', limit: '10' },
      });

      const mockPOs = [
        createPurchaseOrderForLocation('location-A', 'supplier-1', 'po-1'),
        createPurchaseOrderForLocation('location-A', 'supplier-1', 'po-2'),
      ];

      (prisma.purchaseOrder.findMany as jest.Mock).mockResolvedValue(mockPOs);
      (prisma.purchaseOrder.count as jest.Mock).mockResolvedValue(2);

      await purchaseOrderController.getPurchaseOrders(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            locationId: 'location-A',
          }),
        })
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockPOs,
        })
      );
    });

    it('should filter by status within user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        query: { status: 'PENDING', page: '1', limit: '10' },
      });

      const pendingPOs = [createPurchaseOrderForLocation('location-A', 'supplier-1', 'po-1')];
      (prisma.purchaseOrder.findMany as jest.Mock).mockResolvedValue(pendingPOs);
      (prisma.purchaseOrder.count as jest.Mock).mockResolvedValue(1);

      await purchaseOrderController.getPurchaseOrders(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            locationId: 'location-A',
            status: 'PENDING',
          }),
        })
      );
    });

    it('should filter by supplier within user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        query: { supplierId: 'supplier-123', page: '1', limit: '10' },
      });

      const supplierPOs = [
        createPurchaseOrderForLocation('location-A', 'supplier-123', 'po-1'),
      ];
      (prisma.purchaseOrder.findMany as jest.Mock).mockResolvedValue(supplierPOs);
      (prisma.purchaseOrder.count as jest.Mock).mockResolvedValue(1);

      await purchaseOrderController.getPurchaseOrders(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            locationId: 'location-A',
            supplierId: 'supplier-123',
          }),
        })
      );
    });
  });

  describe('createPurchaseOrder - Location Validation', () => {
    it('should create purchase order with user locationId', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        body: {
          supplierId: 'supplier-123',
          expectedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          items: [
            { productId: 'product-1', quantity: 10, unitCost: 5.00 },
            { productId: 'product-2', quantity: 5, unitCost: 10.00 },
          ],
          notes: 'Test order',
        },
      });

      const mockSupplier = createSupplierForLocation('location-A', 'supplier-123');
      const mockProduct1 = createProductForLocation('location-A', 'product-1');
      const mockProduct2 = createProductForLocation('location-A', 'product-2');
      const createdPO = createPurchaseOrderForLocation('location-A', 'supplier-123', 'new-po-123');

      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.product.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockProduct1)
        .mockResolvedValueOnce(mockProduct2);
      (prisma.purchaseOrder.create as jest.Mock).mockResolvedValue(createdPO);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await purchaseOrderController.createPurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify supplier was validated for location
      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'supplier-123',
          locationId: 'location-A',
        },
      });

      // Verify all products were validated for location
      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'product-1',
          locationId: 'location-A',
        },
      });

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'product-2',
          locationId: 'location-A',
        },
      });

      // Verify PO was created with correct locationId
      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          locationId: 'location-A',
          supplierId: 'supplier-123',
        }),
      });

      expectActivityLogHasLocation(prisma.activityLog.create as jest.Mock, 'location-A');
      expect(mockResponse.status).toHaveBeenCalledWith(201);
    });

    it('should block creation if supplier is from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        body: {
          supplierId: 'supplier-from-B',
          expectedDate: new Date().toISOString(),
          items: [{ productId: 'product-1', quantity: 10, unitCost: 5.00 }],
        },
      });

      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        purchaseOrderController.createPurchaseOrder(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Supplier not found');

      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('should block creation if any product is from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        body: {
          supplierId: 'supplier-123',
          expectedDate: new Date().toISOString(),
          items: [
            { productId: 'product-1', quantity: 10, unitCost: 5.00 },
            { productId: 'product-from-B', quantity: 5, unitCost: 10.00 },
          ],
        },
      });

      const mockSupplier = createSupplierForLocation('location-A', 'supplier-123');
      const mockProduct1 = createProductForLocation('location-A', 'product-1');

      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.product.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockProduct1)
        .mockResolvedValueOnce(null); // Second product not found

      await expect(
        purchaseOrderController.createPurchaseOrder(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Product product-from-B not found');

      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });
  });

  describe('updatePurchaseOrder - Location Validation', () => {
    it('should allow update of purchase order in user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'po-123' },
        body: {
          status: 'ORDERED',
          notes: 'Updated notes',
        },
      });

      const existingPO = createPurchaseOrderForLocation('location-A', 'supplier-123', 'po-123');
      const updatedPO = { ...existingPO, status: 'ORDERED', notes: 'Updated notes' };

      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(existingPO);
      (prisma.purchaseOrder.update as jest.Mock).mockResolvedValue(updatedPO);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await purchaseOrderController.updatePurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'po-123',
          locationId: 'location-A',
        },
      });

      expect(prisma.purchaseOrder.update).toHaveBeenCalled();
      expectActivityLogHasLocation(prisma.activityLog.create as jest.Mock, 'location-A');
    });

    it('should block update of purchase order from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'po-from-B' },
        body: { status: 'ORDERED' },
      });

      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        purchaseOrderController.updatePurchaseOrder(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Purchase order not found');

      expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
    });
  });

  describe('receivePurchaseOrder - Location Validation & Inventory Tracking', () => {
    it('should receive purchase order and update inventory with locationId', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'po-123' },
        body: {
          items: [
            { productId: 'product-1', receivedQuantity: 10 },
            { productId: 'product-2', receivedQuantity: 5 },
          ],
        },
      });

      const existingPO = {
        ...createPurchaseOrderForLocation('location-A', 'supplier-123', 'po-123'),
        items: [
          { id: 'item-1', productId: 'product-1', quantity: 10, unitCost: 5.00 },
          { id: 'item-2', productId: 'product-2', quantity: 5, unitCost: 10.00 },
        ],
      };

      const mockProduct1 = { ...createProductForLocation('location-A', 'product-1'), stockQuantity: 100 };
      const mockProduct2 = { ...createProductForLocation('location-A', 'product-2'), stockQuantity: 50 };

      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(existingPO);
      (prisma.product.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockProduct1)
        .mockResolvedValueOnce(mockProduct2);
      (prisma.product.update as jest.Mock).mockResolvedValue({});
      (prisma.purchaseOrder.update as jest.Mock).mockResolvedValue({
        ...existingPO,
        status: 'RECEIVED',
      });
      (prisma.inventoryLog.create as jest.Mock).mockResolvedValue({});
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await purchaseOrderController.receivePurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Verify PO was validated for location
      expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'po-123',
          locationId: 'location-A',
        },
        include: expect.any(Object),
      });

      // Verify inventory logs include locationId
      expect(prisma.inventoryLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          productId: 'product-1',
          type: 'PURCHASE',
          quantity: 10,
          userId: mockRequest.user?.id,
          locationId: 'location-A',
        }),
      });

      expect(prisma.inventoryLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          productId: 'product-2',
          type: 'PURCHASE',
          quantity: 5,
          userId: mockRequest.user?.id,
          locationId: 'location-A',
        }),
      });

      expectActivityLogHasLocation(prisma.activityLog.create as jest.Mock, 'location-A');
    });

    it('should block receiving PO from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'MANAGER', {
        params: { id: 'po-from-B' },
        body: {
          items: [{ productId: 'product-1', receivedQuantity: 10 }],
        },
      });

      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        purchaseOrderController.receivePurchaseOrder(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Purchase order not found');

      expect(prisma.inventoryLog.create).not.toHaveBeenCalled();
    });
  });

  describe('deletePurchaseOrder - Location Validation', () => {
    it('should allow delete of purchase order in user location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'ADMIN', {
        params: { id: 'po-123' },
      });

      const existingPO = createPurchaseOrderForLocation('location-A', 'supplier-123', 'po-123');
      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(existingPO);
      (prisma.purchaseOrder.delete as jest.Mock).mockResolvedValue(existingPO);
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await purchaseOrderController.deletePurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'po-123',
          locationId: 'location-A',
        },
      });

      expect(prisma.purchaseOrder.delete).toHaveBeenCalledWith({
        where: { id: 'po-123' },
      });
    });

    it('should block delete of purchase order from different location', async () => {
      const mockRequest = createRequestWithLocation('location-A', 'ADMIN', {
        params: { id: 'po-from-B' },
      });

      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        purchaseOrderController.deletePurchaseOrder(
          mockRequest as AuthRequest,
          mockResponse as Response,
          mockNext
        )
      ).rejects.toThrow('Purchase order not found');

      expect(prisma.purchaseOrder.delete).not.toHaveBeenCalled();
    });
  });
});
