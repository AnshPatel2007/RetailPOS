import { Response } from 'express';
import * as purchaseOrderController from '../controllers/purchaseOrder.controller';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { createMockResponse, createMockNext, createMockAuthRequest } from './utils/testHelpers';

// Mock Prisma
jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    purchaseOrder: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    purchaseOrderItem: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    supplier: {
      findUnique: jest.fn(),
    },
    inventoryLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  },
}));

const mockOrder = {
  id: 'po-123',
  orderNumber: 'PO2026070001',
  supplierId: 'supplier-123',
  status: 'PENDING',
  totalAmount: 100.0,
  notes: null,
  locationId: 'location-123',
  orderedAt: null,
  expectedAt: null,
  receivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSupplier = {
  id: 'supplier-123',
  name: 'Test Supplier',
  locationId: 'location-123',
};

describe('Purchase Order Controller', () => {
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockResponse = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockResolvedValue([]);
  });

  describe('getPurchaseOrders', () => {
    it('should return paginated purchase orders', async () => {
      const mockRequest = createMockAuthRequest({ query: { page: '1', limit: '20' } });

      (prisma.purchaseOrder.findMany as jest.Mock).mockResolvedValue([mockOrder]);
      (prisma.purchaseOrder.count as jest.Mock).mockResolvedValue(1);

      await purchaseOrderController.getPurchaseOrders(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: [mockOrder],
          pagination: expect.objectContaining({ total: 1 }),
        })
      );
    });

    it('should filter by status and supplier', async () => {
      const mockRequest = createMockAuthRequest({
        query: { status: 'PENDING', supplierId: 'supplier-123' },
      });

      (prisma.purchaseOrder.findMany as jest.Mock).mockResolvedValue([mockOrder]);
      (prisma.purchaseOrder.count as jest.Mock).mockResolvedValue(1);

      await purchaseOrderController.getPurchaseOrders(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PENDING',
            supplierId: 'supplier-123',
          }),
        })
      );
    });
  });

  describe('getPurchaseOrder', () => {
    it('should return a purchase order with supplier and items', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'po-123' } });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        supplier: { id: 'supplier-123' },
        items: [],
      });

      await purchaseOrderController.getPurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should error when order not found', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'nonexistent' } });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(null);

      await purchaseOrderController.getPurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Purchase order not found', statusCode: 404 })
      );
    });
  });

  describe('createPurchaseOrder', () => {
    const orderBody = {
      supplierId: 'supplier-123',
      items: [{ productId: 'product-1', quantity: 10, cost: 5.0 }],
      notes: 'Restock',
    };

    it('should create a purchase order with computed totals', async () => {
      const mockRequest = createMockAuthRequest({ body: orderBody });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(null); // order number gen
      (prisma.product.findMany as jest.Mock).mockResolvedValue([
        { id: 'product-1', sku: 'SKU001', name: 'Product 1' },
      ]);
      (prisma.purchaseOrder.create as jest.Mock).mockResolvedValue({
        ...mockOrder,
        totalAmount: 50.0,
        items: [],
        supplier: { id: 'supplier-123', name: 'Test' },
      });

      await purchaseOrderController.createPurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            supplierId: 'supplier-123',
            totalAmount: 50.0, // 10 × $5
            items: {
              create: [
                expect.objectContaining({
                  productId: 'product-1',
                  quantity: 10,
                  cost: 5.0,
                  total: 50.0,
                }),
              ],
            },
          }),
        })
      );
      expect(mockResponse.status).toHaveBeenCalledWith(201);
    });

    it('should error when supplier does not exist', async () => {
      const mockRequest = createMockAuthRequest({ body: orderBody });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(null);

      await purchaseOrderController.createPurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Supplier not found' })
      );
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('should error when a product does not exist', async () => {
      const mockRequest = createMockAuthRequest({ body: orderBody });

      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]); // none found

      await purchaseOrderController.createPurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Product not found') })
      );
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('should update status and stamp orderedAt', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'po-123' },
        body: { status: 'ORDERED' },
      });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.purchaseOrder.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: 'ORDERED',
        supplier: {},
      });

      await purchaseOrderController.updateStatus(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po-123' },
          data: expect.objectContaining({
            status: 'ORDERED',
            orderedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should reject an invalid status', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'po-123' },
        body: { status: 'BOGUS' },
      });

      await purchaseOrderController.updateStatus(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid status' })
      );
    });
  });

  describe('receivePurchaseOrder', () => {
    const orderWithItems = {
      ...mockOrder,
      status: 'ORDERED',
      items: [
        {
          id: 'poi-1',
          productId: 'product-1',
          sku: 'SKU001',
          productName: 'Product 1',
          quantity: 10,
          cost: 5.0,
          total: 50.0,
        },
      ],
    };

    it('should update inventory and mark order received', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'po-123' },
        body: {},
      });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(orderWithItems);
      (prisma.product.findUnique as jest.Mock).mockResolvedValue({
        id: 'product-1',
        stockQuantity: 5,
      });

      await purchaseOrderController.receivePurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      // Stock incremented by received quantity (5 + 10)
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'product-1' },
          data: { stockQuantity: 15 },
        })
      );
      expect(prisma.inventoryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'product-1',
            type: 'PURCHASE',
            quantity: 10,
          }),
        })
      );
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Purchase order received and inventory updated',
        })
      );
    });

    it('should report variances when received quantity differs', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'po-123' },
        body: { receivedItems: [{ productId: 'product-1', quantity: 8 }] },
      });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(orderWithItems);
      (prisma.product.findUnique as jest.Mock).mockResolvedValue({
        id: 'product-1',
        stockQuantity: 5,
      });

      await purchaseOrderController.receivePurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            variances: [
              expect.objectContaining({ ordered: 10, received: 8, variance: -2 }),
            ],
          }),
        })
      );
    });

    it('should reject receiving an already-received order', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'po-123' }, body: {} });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
        ...orderWithItems,
        status: 'RECEIVED',
      });

      await purchaseOrderController.receivePurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Order has already been received' })
      );
    });

    it('should reject receiving a cancelled order', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'po-123' }, body: {} });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
        ...orderWithItems,
        status: 'CANCELLED',
      });

      await purchaseOrderController.receivePurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Cannot receive a cancelled order' })
      );
    });
  });

  describe('cancelPurchaseOrder', () => {
    it('should cancel a pending order', async () => {
      const mockRequest = createMockAuthRequest({
        params: { id: 'po-123' },
        body: { reason: 'No longer needed' },
      });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.purchaseOrder.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: 'CANCELLED',
      });

      await purchaseOrderController.cancelPurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po-123' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        })
      );
    });

    it('should reject cancelling a received order', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'po-123' }, body: {} });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: 'RECEIVED',
      });

      await purchaseOrderController.cancelPurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Cannot cancel a received order' })
      );
    });
  });

  describe('deletePurchaseOrder', () => {
    it('should delete a pending order', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'po-123' } });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.purchaseOrder.delete as jest.Mock).mockResolvedValue(mockOrder);

      await purchaseOrderController.deletePurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.purchaseOrder.delete).toHaveBeenCalledWith({ where: { id: 'po-123' } });
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should reject deleting a received order', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'po-123' } });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: 'RECEIVED',
      });

      await purchaseOrderController.deletePurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Cannot delete a received order' })
      );
      expect(prisma.purchaseOrder.delete).not.toHaveBeenCalled();
    });

    it('should error when order not found', async () => {
      const mockRequest = createMockAuthRequest({ params: { id: 'nonexistent' } });

      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(null);

      await purchaseOrderController.deletePurchaseOrder(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Purchase order not found' })
      );
    });
  });
});
