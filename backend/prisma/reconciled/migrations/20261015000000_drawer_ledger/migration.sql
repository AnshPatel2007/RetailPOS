-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestHash" TEXT;

-- AlterTable
-- Existing shifts have no reliable record of which drawer paid a reversal.
-- Preserve closed counts and expose this limitation instead of guessing.
ALTER TABLE "shifts" ADD COLUMN "drawerHistoryComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shifts" ALTER COLUMN "drawerHistoryComplete" SET DEFAULT true;

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateTable
CREATE TABLE "drawer_entries" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "locationId" TEXT,
    "userId" TEXT NOT NULL,
    "saleId" TEXT,
    "refundId" TEXT,
    "cashMovementId" TEXT,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drawer_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drawer_entries_sourceKey_key" ON "drawer_entries"("sourceKey");

-- CreateIndex
CREATE INDEX "drawer_entries_shiftId_createdAt_idx" ON "drawer_entries"("shiftId", "createdAt");

-- CreateIndex
CREATE INDEX "drawer_entries_locationId_createdAt_idx" ON "drawer_entries"("locationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotencyKey_key" ON "refunds"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_idempotencyKey_key" ON "cash_movements"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "drawer_entries" ADD CONSTRAINT "drawer_entries_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawer_entries" ADD CONSTRAINT "drawer_entries_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawer_entries" ADD CONSTRAINT "drawer_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawer_entries" ADD CONSTRAINT "drawer_entries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawer_entries" ADD CONSTRAINT "drawer_entries_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawer_entries" ADD CONSTRAINT "drawer_entries_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "cash_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only original cash receipts and explicit cash movements are reconstructable.
-- A later refund/void does not erase the original receipt from its drawer.
INSERT INTO drawer_entries (id, "sourceKey", "shiftId", "locationId", "userId", "saleId", type, amount, "createdAt")
SELECT 'legacy-sale:' || s.id, 'sale:' || s.id, s."shiftId", s."locationId", s."userId", s.id, 'SALE',
  CASE WHEN EXISTS (SELECT 1 FROM sale_payments p WHERE p."saleId" = s.id)
    THEN COALESCE((SELECT SUM(ROUND(p.amount::numeric, 2)) FROM sale_payments p WHERE p."saleId" = s.id AND p."paymentMethod" = 'CASH'), 0)
      - CASE WHEN EXISTS (SELECT 1 FROM sale_payments p WHERE p."saleId" = s.id AND p."paymentMethod" = 'CASH') THEN ROUND(GREATEST(s."changeDue", 0)::numeric, 2) ELSE 0 END
    WHEN s."paymentMethod" = 'CASH' THEN ROUND(s.total::numeric, 2) ELSE 0 END,
  s."createdAt"
FROM sales s WHERE s."shiftId" IS NOT NULL AND s.status IN ('COMPLETED', 'REFUNDED', 'VOIDED');

INSERT INTO drawer_entries (id, "sourceKey", "shiftId", "locationId", "userId", "cashMovementId", type, amount, "createdAt")
SELECT 'legacy-movement:' || m.id, 'movement:' || m.id, m."shiftId", s."locationId", m."userId", m.id, m.type,
  ROUND(m.amount::numeric, 2) * CASE WHEN m.type = 'PAID_IN' THEN 1 ELSE -1 END, m."createdAt"
FROM cash_movements m JOIN shifts s ON s.id = m."shiftId";

CREATE FUNCTION protect_drawer_entries() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Drawer entries are immutable; append a correction entry instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER drawer_entries_immutable BEFORE UPDATE OR DELETE ON drawer_entries
FOR EACH ROW EXECUTE FUNCTION protect_drawer_entries();

