-- Shelf labels to reprint after a price change. Purely additive: four nullable
-- columns and two triggers; no data is changed. Existing items start with no
-- recorded price change, so nothing is listed until a price actually changes.
ALTER TABLE "products"
  ADD COLUMN "priceChangedAt" TIMESTAMP(3),
  ADD COLUMN "labelPrintedAt" TIMESTAMP(3);
ALTER TABLE "product_selling_units"
  ADD COLUMN "priceChangedAt" TIMESTAMP(3),
  ADD COLUMN "labelPrintedAt" TIMESTAMP(3);

-- A trigger covers every write path (product form, price review, bulk and CSV
-- updates, pack edits, the shared catalog). Times are UTC like every column the
-- app writes, whatever the database session's time zone is.
CREATE FUNCTION mark_price_changed() RETURNS trigger AS $$
BEGIN
  IF NEW."price" IS DISTINCT FROM OLD."price" THEN
    NEW."priceChangedAt" := now() AT TIME ZONE 'UTC';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER products_price_changed BEFORE UPDATE OF "price" ON "products"
FOR EACH ROW EXECUTE FUNCTION mark_price_changed();
CREATE TRIGGER product_selling_units_price_changed BEFORE UPDATE OF "price" ON "product_selling_units"
FOR EACH ROW EXECUTE FUNCTION mark_price_changed();
