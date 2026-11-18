ALTER TABLE products ADD COLUMN "baseUnitName" TEXT NOT NULL DEFAULT 'unit';

CREATE TABLE product_selling_units (
  id TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "locationId" TEXT NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT NOT NULL,
  price DECIMAL(14,4) NOT NULL CHECK (price > 0),
  "unitsPerPackage" INTEGER NOT NULL CHECK ("unitsPerPackage" BETWEEN 2 AND 100000),
  "sealedQuantity" INTEGER NOT NULL DEFAULT 0 CHECK ("sealedQuantity" >= 0),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 0,
  "createRequestKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT product_selling_units_barcode_location_key UNIQUE (barcode, "locationId"),
  CONSTRAINT product_selling_units_sku_location_key UNIQUE (sku, "locationId"),
  CONSTRAINT product_selling_units_request_location_key UNIQUE ("createRequestKey", "locationId")
);
CREATE INDEX product_selling_units_product_idx ON product_selling_units ("productId");
CREATE INDEX product_selling_units_location_idx ON product_selling_units ("locationId");

CREATE TABLE product_packaging_events (
  id TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "sellingUnitId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  kind TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  "previousQuantity" INTEGER NOT NULL,
  "newQuantity" INTEGER NOT NULL,
  "sourceId" TEXT,
  "requestKey" TEXT,
  notes TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_packaging_events_location_request_key UNIQUE ("locationId", "requestKey")
);
CREATE INDEX product_packaging_events_product_created_idx ON product_packaging_events ("productId", "createdAt");

-- Serialize an identifier across both tables; a simultaneous carton/product
-- creation must never leave an ambiguous scanner code in the same store.
CREATE FUNCTION check_product_selling_identifier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."locationId" IS NULL THEN RETURN NEW; END IF;
  IF NEW.barcode IS NOT NULL AND NEW.barcode <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."locationId" || ':barcode:' || NEW.barcode, 0));
    IF TG_TABLE_NAME = 'products' THEN
      IF EXISTS (SELECT 1 FROM product_selling_units WHERE "locationId" = NEW."locationId" AND barcode = NEW.barcode) THEN
        RAISE EXCEPTION 'Barcode already belongs to a linked selling package' USING ERRCODE = '23505';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM products WHERE "locationId" = NEW."locationId" AND barcode = NEW.barcode) THEN
      RAISE EXCEPTION 'Barcode already belongs to a product' USING ERRCODE = '23505';
    END IF;
  END IF;
  IF NEW.sku IS NOT NULL AND NEW.sku <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."locationId" || ':sku:' || NEW.sku, 0));
    IF TG_TABLE_NAME = 'products' THEN
      IF EXISTS (SELECT 1 FROM product_selling_units WHERE "locationId" = NEW."locationId" AND sku = NEW.sku) THEN
        RAISE EXCEPTION 'SKU already belongs to a linked selling package' USING ERRCODE = '23505';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM products WHERE "locationId" = NEW."locationId" AND sku = NEW.sku) THEN
      RAISE EXCEPTION 'SKU already belongs to a product' USING ERRCODE = '23505';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'product_selling_units' THEN
    IF NOT EXISTS (SELECT 1 FROM products WHERE id = NEW."productId" AND "locationId" = NEW."locationId" AND "trackInventory" = true AND "priceEmbedded" = false) THEN
      RAISE EXCEPTION 'Selling package must belong to a tracked unit product in the same store' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (OLD."productId" <> NEW."productId" OR OLD."locationId" <> NEW."locationId" OR OLD."unitsPerPackage" <> NEW."unitsPerPackage") THEN
      RAISE EXCEPTION 'Package connection and quantity cannot be changed; create another selling package' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER products_selling_identifier BEFORE INSERT OR UPDATE OF barcode, sku, "locationId" ON products FOR EACH ROW EXECUTE FUNCTION check_product_selling_identifier();
CREATE TRIGGER selling_units_identifier BEFORE INSERT OR UPDATE ON product_selling_units FOR EACH ROW EXECUTE FUNCTION check_product_selling_identifier();
