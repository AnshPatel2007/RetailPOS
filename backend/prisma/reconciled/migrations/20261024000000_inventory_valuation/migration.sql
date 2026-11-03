-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "costingActivatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "verifiedUnitCost" DECIMAL(24,8);

-- AlterTable
ALTER TABLE "purchase_receipts" ADD COLUMN     "acquisitionTax" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "freight" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceDate" TIMESTAMP(3),
ADD COLUMN     "invoiceDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceNumber" TEXT;

-- AlterTable
ALTER TABLE "purchase_receipt_items" ADD COLUMN     "allocatedCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "inventoryEntryId" TEXT,
ADD COLUMN     "inventoryValue" DECIMAL(24,8),
ADD COLUMN     "lineDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "packSize" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "unitCost" DECIMAL(24,8);

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "costAmount" DECIMAL(24,8),
ADD COLUMN     "inventoryEntryId" TEXT;

-- AlterTable
ALTER TABLE "transfer_items" ADD COLUMN     "dispatchedValue" DECIMAL(24,8),
ADD COLUMN     "inventoryEntryId" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "inventoryReceiptId" TEXT;

-- CreateTable
CREATE TABLE "inventory_valuations" (
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "value" DECIMAL(24,8),
    "lastEntryId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_valuations_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "inventory_value_entries" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quantityBefore" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "inputValue" DECIMAL(24,8),
    "valueBefore" DECIMAL(24,8),
    "valueChange" DECIMAL(24,8),
    "valueAfter" DECIMAL(24,8),
    "cogsAmount" DECIMAL(24,8),
    "referenceEntryId" TEXT,
    "referenceQuantity" INTEGER,
    "referenceOffset" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_value_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_corrections" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceEntryId" TEXT NOT NULL,
    "inputValue" DECIMAL(24,8) NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "preview" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_revisions" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "correctionId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "inputValue" DECIMAL(24,8),
    "valueBefore" DECIMAL(24,8),
    "valueChange" DECIMAL(24,8),
    "valueAfter" DECIMAL(24,8),
    "cogsAmount" DECIMAL(24,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "receiptEntryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "creditAmount" DECIMAL(14,2) NOT NULL,
    "carryingValue" DECIMAL(24,8),
    "costAdjustment" DECIMAL(24,8),
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_valuations_locationId_idx" ON "inventory_valuations"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_value_entries_sequence_key" ON "inventory_value_entries"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_value_entries_sourceKey_key" ON "inventory_value_entries"("sourceKey");

-- CreateIndex
CREATE INDEX "inventory_value_entries_locationId_createdAt_sequence_idx" ON "inventory_value_entries"("locationId", "createdAt", "sequence");

-- CreateIndex
CREATE INDEX "inventory_value_entries_productId_sequence_idx" ON "inventory_value_entries"("productId", "sequence");

-- CreateIndex
CREATE INDEX "inventory_value_entries_referenceEntryId_idx" ON "inventory_value_entries"("referenceEntryId");

-- CreateIndex
CREATE INDEX "inventory_value_entries_sourceId_idx" ON "inventory_value_entries"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_corrections_idempotencyKey_key" ON "inventory_cost_corrections"("idempotencyKey");

-- CreateIndex
CREATE INDEX "inventory_cost_corrections_locationId_createdAt_idx" ON "inventory_cost_corrections"("locationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_revisions_sequence_key" ON "inventory_cost_revisions"("sequence");

-- CreateIndex
CREATE INDEX "inventory_cost_revisions_entryId_sequence_idx" ON "inventory_cost_revisions"("entryId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_revisions_correctionId_entryId_key" ON "inventory_cost_revisions"("correctionId", "entryId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_idempotencyKey_key" ON "supplier_returns"("idempotencyKey");

-- CreateIndex
CREATE INDEX "supplier_returns_locationId_createdAt_idx" ON "supplier_returns"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "supplier_returns_receiptEntryId_idx" ON "supplier_returns"("receiptEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipt_items_inventoryEntryId_key" ON "purchase_receipt_items"("inventoryEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_inventoryEntryId_key" ON "sale_items"("inventoryEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_items_inventoryEntryId_key" ON "transfer_items"("inventoryEntryId");

-- Cost records cannot be rewritten or removed, including by an ordinary SQL client.
CREATE FUNCTION protect_inventory_cost_fact() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Inventory cost facts are immutable; post an audited correction'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_value_immutable BEFORE UPDATE OR DELETE ON inventory_value_entries FOR EACH ROW EXECUTE FUNCTION protect_inventory_cost_fact();
CREATE TRIGGER inventory_correction_immutable BEFORE UPDATE OR DELETE ON inventory_cost_corrections FOR EACH ROW EXECUTE FUNCTION protect_inventory_cost_fact();
CREATE TRIGGER inventory_revision_immutable BEFORE UPDATE OR DELETE ON inventory_cost_revisions FOR EACH ROW EXECUTE FUNCTION protect_inventory_cost_fact();
CREATE TRIGGER supplier_return_immutable BEFORE UPDATE OR DELETE ON supplier_returns FOR EACH ROW EXECUTE FUNCTION protect_inventory_cost_fact();
ALTER TABLE inventory_valuations ADD CONSTRAINT inventory_balance_nonnegative CHECK (quantity >= 0 AND (value IS NULL OR value >= 0));
ALTER TABLE inventory_value_entries ADD CONSTRAINT inventory_entry_quantities CHECK ("quantityBefore" >= 0 AND "quantityAfter" >= 0 AND "quantityBefore" + quantity = "quantityAfter");
