-- Cost-change check at receiving, and money suppliers owe the store.
-- Purely additive: one nullable column and one new table.

-- The item's cost price before each delivery, so a receipt can show
-- "$7.10 -> $7.45". Written when the receipt line is created; older receipt
-- lines stay NULL (not known).
ALTER TABLE "purchase_receipt_items" ADD COLUMN "previousUnitCost" DECIMAL(24,8);

-- Credits a supplier owes: damaged or rejected goods the invoice still charged
-- for, returns, shortages and price corrections. OPEN until the credit arrives
-- (RECEIVED) or is written off (WRITTEN_OFF). A supplier with credits cannot be
-- deleted (deactivate it instead).
CREATE TABLE "supplier_credits" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "receiptId" TEXT,
  "reason" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  "settledById" TEXT,
  CONSTRAINT "supplier_credits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "supplier_credits_locationId_status_idx" ON "supplier_credits"("locationId", "status");
CREATE INDEX "supplier_credits_supplierId_idx" ON "supplier_credits"("supplierId");
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
