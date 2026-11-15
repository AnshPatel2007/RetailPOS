-- Receiving a delivery from a photo of its invoice. Purely additive: three new tables.

-- An invoice someone photographed (a cashier may): read by AI, matched to products,
-- and waiting until an owner or manager checks it. Nothing reaches stock until it is
-- received through the reviewed receipt import (its id is kept in "importId", so a
-- retry re-applies that one import and never adds stock twice).
-- READING -> READY (or FAILED, read again) -> RECEIVED or DISCARDED.
CREATE TABLE "delivery_invoices" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READING',
  "vendorName" TEXT,
  "supplierId" TEXT,
  "invoiceNumber" TEXT,
  "invoiceDate" DATE,
  "subtotal" DECIMAL(14,2),
  "tax" DECIMAL(14,2),
  "fees" DECIMAL(14,2),
  "discount" DECIMAL(14,2),
  "total" DECIMAL(14,2),
  "reading" JSONB,
  "lines" JSONB,
  "error" TEXT,
  "importId" TEXT,
  "purchaseOrderId" TEXT,
  "purchaseReceiptId" TEXT,
  "receivedById" TEXT,
  "receivedAt" TIMESTAMP(3),
  "discardedById" TEXT,
  "discardedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "delivery_invoices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "delivery_invoices_locationId_status_idx" ON "delivery_invoices"("locationId", "status");

-- The kept photos (or PDF) of each invoice; the files live in uploads/invoices.
CREATE TABLE "delivery_invoice_pages" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_invoice_pages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "delivery_invoice_pages_filename_key" ON "delivery_invoice_pages"("filename");
CREATE UNIQUE INDEX "delivery_invoice_pages_invoiceId_pageNumber_key" ON "delivery_invoice_pages"("invoiceId", "pageNumber");
ALTER TABLE "delivery_invoice_pages" ADD CONSTRAINT "delivery_invoice_pages_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "delivery_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What a supplier's invoice line means in this store, learned whenever an owner or
-- manager confirms a line: by the supplier's item number when printed, else by the
-- line's normalized text. The next invoice then matches that line for sure.
CREATE TABLE "invoice_item_matches" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "itemCode" TEXT,
  "normalizedText" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sellingUnitId" TEXT,
  "unitsPerCase" INTEGER,
  "confirmations" INTEGER NOT NULL DEFAULT 1,
  "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_item_matches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invoice_item_matches_supplierId_normalizedText_key" ON "invoice_item_matches"("supplierId", "normalizedText");
CREATE INDEX "invoice_item_matches_supplierId_itemCode_idx" ON "invoice_item_matches"("supplierId", "itemCode");
CREATE INDEX "invoice_item_matches_productId_idx" ON "invoice_item_matches"("productId");
ALTER TABLE "invoice_item_matches" ADD CONSTRAINT "invoice_item_matches_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_item_matches" ADD CONSTRAINT "invoice_item_matches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
