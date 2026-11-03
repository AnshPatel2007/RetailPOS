ALTER TABLE "sales" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'RECEIPT';
ALTER TABLE "sales" ADD COLUMN "sourceData" JSONB;
ALTER TABLE "expenses" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'TRANSACTION';
CREATE TABLE "historical_income" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "recognizedAt" TIMESTAMP(3) NOT NULL,
  "notes" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "historical_income_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "historical_income_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "historical_income_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "historical_income_kind_check" CHECK ("kind" IN ('GAMING_ATM','LOTTERY_COMMISSION'))
);
CREATE UNIQUE INDEX "historical_income_sourceKey_key" ON "historical_income"("sourceKey");
CREATE INDEX "historical_income_locationId_recognizedAt_idx" ON "historical_income"("locationId", "recognizedAt");
