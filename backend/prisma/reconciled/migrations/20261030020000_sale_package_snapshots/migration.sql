ALTER TABLE "sale_items" ADD COLUMN "sellingUnitId" TEXT,
  ADD COLUMN "unitsPerPackage" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "inventoryQuantity" INTEGER;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_package_quantity_check"
  CHECK ("unitsPerPackage" > 0 AND ("inventoryQuantity" IS NULL OR "inventoryQuantity" = "quantity"::bigint * "unitsPerPackage"));
ALTER TABLE "refund_items" ADD COLUMN "restockedAsSealed" BOOLEAN NOT NULL DEFAULT false;
