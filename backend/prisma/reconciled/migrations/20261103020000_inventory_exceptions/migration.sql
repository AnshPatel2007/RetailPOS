-- Negative-stock discrepancy alerts, wrong-SKU sale-line corrections, and the
-- structured product attributes used to suggest related SKUs.
ALTER TABLE products ADD COLUMN brand TEXT, ADD COLUMN "productFamily" TEXT, ADD COLUMN variant TEXT, ADD COLUMN size TEXT;
CREATE INDEX "products_locationId_productFamily_idx" ON products("locationId", "productFamily");
CREATE INDEX "products_locationId_brand_idx" ON products("locationId", brand);

CREATE TABLE inventory_exceptions (
  id TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "openProductId" TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  "firstNegativeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastNegativeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "triggerSaleId" TEXT,
  "triggerEntryId" TEXT,
  "lowestQuantity" INTEGER NOT NULL,
  "latestQuantity" INTEGER NOT NULL,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "assignedToId" TEXT,
  "recountRequestedAt" TIMESTAMP(3),
  "recountRequestedById" TEXT,
  "countedQuantity" INTEGER,
  "adjustmentEntryId" TEXT,
  resolution TEXT,
  "resolutionNotes" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_exceptions_productId_fkey" FOREIGN KEY ("productId") REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT inventory_exception_state CHECK (
    status IN ('OPEN', 'RECOUNT_REQUESTED', 'RESOLVED') AND
    ((status = 'RESOLVED') = ("openProductId" IS NULL)) AND
    ("openProductId" IS NULL OR "openProductId" = "productId") AND
    (status <> 'RESOLVED' OR (resolution IS NOT NULL AND "resolvedAt" IS NOT NULL)))
);
CREATE UNIQUE INDEX "inventory_exceptions_openProductId_key" ON inventory_exceptions("openProductId");
CREATE INDEX "inventory_exceptions_locationId_status_lastNegativeAt_idx" ON inventory_exceptions("locationId", status, "lastNegativeAt");
CREATE INDEX "inventory_exceptions_productId_createdAt_idx" ON inventory_exceptions("productId", "createdAt");

CREATE TABLE sale_item_corrections (
  id TEXT NOT NULL PRIMARY KEY,
  "saleId" TEXT NOT NULL,
  "saleItemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "fromProductId" TEXT NOT NULL,
  "toProductId" TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  notes TEXT,
  "userId" TEXT NOT NULL,
  "reverseEntryId" TEXT,
  "applyEntryId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sale_item_correction_distinct CHECK ("fromProductId" <> "toProductId")
);
CREATE UNIQUE INDEX "sale_item_corrections_idempotencyKey_key" ON sale_item_corrections("idempotencyKey");
CREATE INDEX "sale_item_corrections_saleItemId_idx" ON sale_item_corrections("saleItemId");
CREATE INDEX "sale_item_corrections_locationId_createdAt_idx" ON sale_item_corrections("locationId", "createdAt");
