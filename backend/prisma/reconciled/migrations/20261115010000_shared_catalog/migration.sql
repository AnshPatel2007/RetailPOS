-- Shared catalog (UPGRADE_PLAN WP 5.1). Additive: two new tables and four new
-- nullable/defaulted columns. Each store keeps its own products (stock, cost, price);
-- an owner-managed catalog item links the same item across the organization's stores
-- and owns the shared fields. No picture column: products carry no pictures.

CREATE TABLE "catalog_items" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "barcode" TEXT,
  "description" TEXT,
  "brand" TEXT,
  "productFamily" TEXT,
  "variant" TEXT,
  "size" TEXT,
  "baseUnitName" TEXT NOT NULL DEFAULT 'unit',
  "categoryName" TEXT,
  "isTaxable" BOOLEAN NOT NULL DEFAULT true,
  "minimumAge" INTEGER,
  "ebtEligible" BOOLEAN NOT NULL DEFAULT false,
  "priceEmbedded" BOOLEAN NOT NULL DEFAULT false,
  "saleBlockedReason" TEXT,
  "defaultPrice" DECIMAL(14,4),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_items_organizationId_sku_key" ON "catalog_items"("organizationId", "sku");
CREATE UNIQUE INDEX "catalog_items_organizationId_barcode_key" ON "catalog_items"("organizationId", "barcode");
CREATE INDEX "catalog_items_organizationId_name_idx" ON "catalog_items"("organizationId", "name");
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A shared pack of a catalog item (a 12-pack, a carton).
CREATE TABLE "catalog_packs" (
  "id" TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "barcode" TEXT NOT NULL,
  "unitsPerPackage" INTEGER NOT NULL,
  "defaultPrice" DECIMAL(14,4),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "catalog_packs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_packs_catalogItemId_barcode_key" ON "catalog_packs"("catalogItemId", "barcode");
ALTER TABLE "catalog_packs" ADD CONSTRAINT "catalog_packs_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A store's product and packs point at the shared item; at most one product per store and item.
ALTER TABLE "products" ADD COLUMN "catalogItemId" TEXT;
ALTER TABLE "products" ADD COLUMN "priceFollowsCatalog" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "products_catalogItemId_locationId_key" ON "products"("catalogItemId", "locationId");
ALTER TABLE "products" ADD CONSTRAINT "products_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_selling_units" ADD COLUMN "catalogPackId" TEXT;
ALTER TABLE "product_selling_units" ADD COLUMN "priceFollowsCatalog" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "product_selling_units_catalog_pack_idx" ON "product_selling_units"("catalogPackId");
ALTER TABLE "product_selling_units" ADD CONSTRAINT "product_selling_units_catalogPackId_fkey" FOREIGN KEY ("catalogPackId") REFERENCES "catalog_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
