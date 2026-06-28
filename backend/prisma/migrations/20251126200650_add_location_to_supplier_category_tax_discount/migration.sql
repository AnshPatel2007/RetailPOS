-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "discounts" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "tax_rates" ADD COLUMN     "locationId" TEXT;

-- CreateIndex
CREATE INDEX "categories_locationId_idx" ON "categories"("locationId");

-- CreateIndex
CREATE INDEX "discounts_locationId_idx" ON "discounts"("locationId");

-- CreateIndex
CREATE INDEX "suppliers_locationId_idx" ON "suppliers"("locationId");

-- CreateIndex
CREATE INDEX "tax_rates_locationId_idx" ON "tax_rates"("locationId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
