-- Products are bought in supplier cases (e.g. 24 cans for $36) and sold as
-- single units or store packs. Purchase orders keep base-unit quantities and
-- per-unit cost; the case size and case price are recorded alongside.
ALTER TABLE product_suppliers
  ADD COLUMN "packSize" INTEGER NOT NULL DEFAULT 1 CHECK ("packSize" BETWEEN 1 AND 100000),
  ADD COLUMN "packCost" DECIMAL(14,4) CHECK ("packCost" IS NULL OR "packCost" >= 0),
  ADD COLUMN "packBarcode" TEXT;

ALTER TABLE purchase_order_items
  ADD COLUMN "packSize" INTEGER NOT NULL DEFAULT 1 CHECK ("packSize" BETWEEN 1 AND 100000),
  ADD COLUMN "packQuantity" INTEGER CHECK ("packQuantity" IS NULL OR "packQuantity" > 0),
  ADD COLUMN "packCost" DECIMAL(14,4) CHECK ("packCost" IS NULL OR "packCost" >= 0);
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_item_pack_quantity
  CHECK ("packQuantity" IS NULL OR quantity = "packQuantity" * "packSize");
