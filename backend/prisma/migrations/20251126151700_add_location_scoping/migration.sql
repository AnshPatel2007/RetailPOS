-- AlterTable
ALTER TABLE "accounting_exports" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "inventory_logs" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "locationId" TEXT;

-- CreateIndex
CREATE INDEX "accounting_exports_locationId_idx" ON "accounting_exports"("locationId");

-- CreateIndex
CREATE INDEX "inventory_logs_locationId_idx" ON "inventory_logs"("locationId");

-- CreateIndex
CREATE INDEX "purchase_orders_locationId_idx" ON "purchase_orders"("locationId");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_logs" ADD CONSTRAINT "inventory_logs_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
