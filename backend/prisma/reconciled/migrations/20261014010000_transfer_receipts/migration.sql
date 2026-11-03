-- AlterTable
ALTER TABLE "inventory_transfers" ADD COLUMN     "receivingHistoryKnown" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "transfer_items" ADD COLUMN     "damagedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "destinationProductId" TEXT,
ADD COLUMN     "missingQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "productSnapshot" JSONB,
ADD COLUMN     "returnDamagedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnMissingQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentBackQty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "transfer_receipts" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_receipt_items" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "transferItemId" TEXT NOT NULL,
    "acceptedQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "missingQty" INTEGER NOT NULL DEFAULT 0,
    "sentBackQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transfer_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfer_receipts_transferId_createdAt_idx" ON "transfer_receipts"("transferId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_receipts_transferId_idempotencyKey_key" ON "transfer_receipts"("transferId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "transfer_receipt_items_receiptId_idx" ON "transfer_receipt_items"("receiptId");

-- CreateIndex
CREATE INDEX "transfer_receipt_items_transferItemId_idx" ON "transfer_receipt_items"("transferItemId");

-- CreateIndex
CREATE INDEX "transfer_items_destinationProductId_idx" ON "transfer_items"("destinationProductId");

-- AddForeignKey
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_destinationProductId_fkey" FOREIGN KEY ("destinationProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "inventory_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipt_items" ADD CONSTRAINT "transfer_receipt_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "transfer_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipt_items" ADD CONSTRAINT "transfer_receipt_items_transferItemId_fkey" FOREIGN KEY ("transferItemId") REFERENCES "transfer_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing shipment history is not reconstructed from current product identities.
UPDATE "inventory_transfers" SET "receivingHistoryKnown" = false WHERE status <> 'PENDING';
