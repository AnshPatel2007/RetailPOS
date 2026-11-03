ALTER TABLE "products" ADD COLUMN "stockVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cycle_count_items" ADD COLUMN "stockVersion" INTEGER;
ALTER TABLE "inventory_logs" ADD COLUMN "locationId" TEXT,
  ADD COLUMN "sourceId" TEXT, ADD COLUMN "stockVersion" INTEGER;

-- Includes legacy writers during the service migration. A quantity moving away
-- and back still invalidates an earlier count. Unknown old count versions stay
-- NULL and require an explicit recount; do not guess a snapshot version.
CREATE FUNCTION advance_product_stock_version() RETURNS trigger AS $$
BEGIN
  IF NEW."stockQuantity" IS DISTINCT FROM OLD."stockQuantity" THEN
    NEW."stockVersion" := OLD."stockVersion" + 1;
  ELSE
    NEW."stockVersion" := OLD."stockVersion";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER product_stock_version BEFORE UPDATE ON "products"
FOR EACH ROW EXECUTE FUNCTION advance_product_stock_version();
