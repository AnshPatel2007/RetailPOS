-- Turning a standalone product into a pack of another product. Stock moves
-- as base units at the same value; the record is immutable history.
CREATE TABLE product_pack_merges (
  id TEXT NOT NULL PRIMARY KEY,
  "locationId" TEXT NOT NULL,
  "sourceProductId" TEXT NOT NULL,
  "baseProductId" TEXT NOT NULL,
  "sellingUnitId" TEXT NOT NULL,
  "sourceQuantity" INTEGER NOT NULL CHECK ("sourceQuantity" >= 0),
  "unitsPerPackage" INTEGER NOT NULL CHECK ("unitsPerPackage" >= 2),
  "movedValue" DECIMAL(24,8),
  "fromEntryId" TEXT,
  "toEntryId" TEXT,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_pack_merge_distinct CHECK ("sourceProductId" <> "baseProductId")
);
CREATE UNIQUE INDEX "product_pack_merges_locationId_idempotencyKey_key" ON product_pack_merges("locationId", "idempotencyKey");
CREATE INDEX "product_pack_merges_sourceProductId_idx" ON product_pack_merges("sourceProductId");
CREATE INDEX "product_pack_merges_baseProductId_idx" ON product_pack_merges("baseProductId");
