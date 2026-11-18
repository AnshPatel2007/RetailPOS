-- Corrections that bring a negative balance back up never cancel the cost of
-- the sales that caused it. Such additions are valued at the shortfall's own
-- cost and recorded as "added without an invoice" for later matching.
ALTER TABLE inventory_value_entries ADD COLUMN "unmatchedValue" DECIMAL(24,8);

CREATE TABLE stock_reclasses (
  id TEXT NOT NULL PRIMARY KEY,
  "locationId" TEXT NOT NULL,
  "fromProductId" TEXT NOT NULL,
  "toProductId" TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL CHECK (reason IN ('SOLD_AS_OTHER', 'RECEIVED_AS_OTHER', 'RETURNED_AS_OTHER')),
  "exceptionId" TEXT,
  "saleId" TEXT,
  "saleItemId" TEXT,
  "fromEntryId" TEXT NOT NULL,
  "toEntryId" TEXT NOT NULL,
  "cogsChange" DECIMAL(24,8),
  "priceDifference" DECIMAL(14,2),
  notes TEXT,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stock_reclass_distinct CHECK ("fromProductId" <> "toProductId")
);
CREATE UNIQUE INDEX "stock_reclasses_idempotencyKey_key" ON stock_reclasses("idempotencyKey");
CREATE INDEX "stock_reclasses_locationId_createdAt_idx" ON stock_reclasses("locationId", "createdAt");
CREATE INDEX "stock_reclasses_fromProductId_idx" ON stock_reclasses("fromProductId");
CREATE INDEX "stock_reclasses_toProductId_idx" ON stock_reclasses("toProductId");

CREATE TABLE unmatched_cost_matches (
  id TEXT NOT NULL PRIMARY KEY,
  "entryId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "actualUnitCost" DECIMAL(14,4) NOT NULL CHECK ("actualUnitCost" >= 0),
  "trueUpEntryId" TEXT NOT NULL,
  notes TEXT,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "unmatched_cost_matches_entryId_key" ON unmatched_cost_matches("entryId");
CREATE INDEX "unmatched_cost_matches_locationId_createdAt_idx" ON unmatched_cost_matches("locationId", "createdAt");
