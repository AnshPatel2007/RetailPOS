export interface TransferProduct { id: string; name: string; sku: string }
export interface TransferItem {
  id: string; productId: string; quantity: number; receivedQty: number; damagedQty: number;
  missingQty: number; sentBackQty: number; returnedQty: number; returnDamagedQty: number; returnMissingQty: number;
  product?: TransferProduct; destinationProductId?: string | null; destinationProduct?: TransferProduct | null;
  productSnapshot?: { name: string; sku: string; barcode?: string | null; price: number; cost: number } | null;
}
export interface Transfer {
  id: string; transferNumber: string; fromLocationId: string; toLocationId: string; status: string;
  fromLocation?: { id: string; name: string }; toLocation?: { id: string; name: string };
  notes: string | null; createdAt: string; updatedAt: string; shippedAt: string | null; receivedAt: string | null;
  receivingHistoryKnown: boolean; items: TransferItem[];
}
export type TransferReceiptKind = 'RECEIVE' | 'SOURCE_RETURN' | 'REQUEST_RETURN';
export interface TransferReceiptLine {
  transferItemId: string; acceptedQty: number; damagedQty: number; missingQty: number; sentBackQty: number;
  destinationProductId?: string; createProduct?: boolean; newSku?: string;
}
export interface TransferReceiptRequest { idempotencyKey: string; notes: string; items: TransferReceiptLine[] }
export interface TransferReceipt {
  id: string; kind: TransferReceiptKind; userId: string; actor?: string; createdAt: string; notes: string; items: TransferReceiptLine[];
}
export const outstandingTransfer = (i: TransferItem) => i.quantity - i.receivedQty - i.damagedQty - i.missingQty - i.sentBackQty;
export const returningTransfer = (i: TransferItem) => i.sentBackQty - i.returnedQty - i.returnDamagedQty - i.returnMissingQty;
export const transferProductName = (i: TransferItem) => i.productSnapshot?.name || i.product?.name || i.productId;
export const transferRetryKey = (transfer: Transfer, userId: string | undefined, kind: TransferReceiptKind) => `pos-transfer-event:${transfer.id}:${userId}:${kind}`;
export function pendingTransferReceipt(key: string): TransferReceiptRequest | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && typeof value.idempotencyKey === 'string' && Array.isArray(value.items) && typeof value.notes === 'string' ? value : null;
  } catch { return null; }
}
