-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "locationId" TEXT;

-- CreateIndex
CREATE INDEX "customers_locationId_idx" ON "customers"("locationId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
