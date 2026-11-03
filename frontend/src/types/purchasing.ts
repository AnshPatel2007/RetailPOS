export interface PurchaseOrderItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  cost: number;
  total: number;
  receivedQty: number;
  damagedQty: number;
  rejectedQty: number;
}

export interface PurchaseReceiptRequest {
  invoiceNumber?: string; invoiceDate?: string; freight?: number; acquisitionTax?: number; invoiceDiscount?: number;
  idempotencyKey: string;
  receivedItems: Array<{ purchaseOrderItemId: string; quantity: number; damagedQty: number; rejectedQty: number; unitCost?: number; packSize?: number; lineDiscount?: number; zeroCostConfirmed?: boolean }>;
  notes: string;
  finalDelivery: boolean;
}

export interface PurchaseReceipt {
  id: string;
  createdAt: string;
  notes?: string;
  finalDelivery: boolean;
  items: Array<{ purchaseOrderItemId: string; acceptedQty: number; damagedQty: number; rejectedQty: number }>;
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  status: string;
  locationId: string;
  totalAmount: number;
  notes?: string;
  expectedAt?: string;
  orderedAt?: string;
  receivedAt?: string;
  createdAt: string;
  receivingHistoryKnown: boolean;
  supplier: { id: string; name: string };
  items?: PurchaseOrderItem[];
  receipts?: PurchaseReceipt[];
  _count?: { items: number };
}

export const outstandingQuantity = (item: PurchaseOrderItem) => item.quantity - item.receivedQty - item.damagedQty - item.rejectedQty;
