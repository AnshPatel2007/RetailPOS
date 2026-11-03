import { Response } from 'express';
import { Prisma } from '@prisma/client';
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
      update: jest.fn(),
    },
    purchaseReceipt: { findUnique: jest.fn(), create: jest.fn(), count: jest.fn() },
    purchaseReceiptItem: { update: jest.fn() },
    inventoryValuation: { findUnique: jest.fn(), update: jest.fn() },
    inventoryValueEntry: { create: jest.fn() },
    activityLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
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
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ value: 100001n }]);
    (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(prisma));
    (prisma.purchaseReceipt.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.purchaseReceipt.count as jest.Mock).mockResolvedValue(0);
    (prisma.purchaseReceipt.create as jest.Mock).mockResolvedValue({ id: 'receipt-1', items: [{ id: 'receipt-line', purchaseOrderItemId: 'poi-1' }] });
    (prisma.inventoryValuation.findUnique as jest.Mock).mockResolvedValue({ quantity: 5, value: null });
    (prisma.inventoryValueEntry.create as jest.Mock).mockImplementation(async ({ data }) => ({ id: 'value-entry', ...data }));
    const product = { id: 'product-1', stockQuantity: 5, trackInventory: true, locationId: 'location-123', stockVersion: 0 };
    (prisma.product.findMany as jest.Mock).mockResolvedValue([product]);
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(product);
    (prisma.product.update as jest.Mock).mockResolvedValue({ ...product, stockVersion: 1 });
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
          receivedQty: 0,
          damagedQty: 0,
          rejectedQty: 0,
          cost: new Prisma.Decimal(5),
          total: 50.0,
        },
      ],
    };

    // Receiving runs inside purchaseReceiving.service with row locks, the cost
    // ledger and package snapshots; mocked-Prisma assertions on product.update no
    // longer describe it. Full and partial deliveries, landed cost, receiving into
    // negative stock and idempotency are covered against a real database in
    // integration/purchaseReceiving.workflow.test.ts, inventoryCost.workflow.test.ts
    // and retailInventory.acceptance.test.ts (scenarios 15 and 16).

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
