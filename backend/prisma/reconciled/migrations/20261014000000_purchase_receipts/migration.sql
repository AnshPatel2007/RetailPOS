-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "receivingHistoryKnown" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "damagedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "receivedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rejectedQty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "notes" TEXT,
    "finalDelivery" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipt_items" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "acceptedQty" INTEGER NOT NULL,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_receipts_purchaseOrderId_createdAt_idx" ON "purchase_receipts"("purchaseOrderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_purchaseOrderId_idempotencyKey_key" ON "purchase_receipts"("purchaseOrderId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "purchase_receipt_items_receiptId_idx" ON "purchase_receipt_items"("receiptId");

-- CreateIndex
CREATE INDEX "purchase_receipt_items_purchaseOrderItemId_idx" ON "purchase_receipt_items"("purchaseOrderItemId");

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Prior closed orders have no trustworthy item-level receiving history.
UPDATE "purchase_orders" SET "receivingHistoryKnown" = false WHERE status = 'RECEIVED';
