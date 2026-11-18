-- Historical receipts retain their original base quantities and costs.
ALTER TABLE "purchase_receipt_items"
  ADD COLUMN "sellingUnitId" TEXT,
  ADD COLUMN "sellingUnitName" TEXT,
  ADD COLUMN "receivedPackageQuantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "receipt_package_quantity_valid"
  CHECK ("receivedPackageQuantity" >= 0 AND
    ("receivedPackageQuantity" = 0 OR
      ("sellingUnitId" IS NOT NULL AND "receivedPackageQuantity"::BIGINT * "packSize" <= "acceptedQty")));
