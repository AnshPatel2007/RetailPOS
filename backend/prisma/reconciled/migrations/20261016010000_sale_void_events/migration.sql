BEGIN;
CREATE TABLE "sale_voids" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "approvalId" TEXT,
  "shiftId" TEXT,
  "reason" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "taxAmount" DECIMAL(14,2) NOT NULL,
  "discount" DECIMAL(14,2) NOT NULL,
  "costReversed" DECIMAL(14,4),
  "pointsRestored" INTEGER,
  "pointsReversed" INTEGER,
  "items" JSONB NOT NULL,
  "tenders" JSONB NOT NULL,
  "idempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sale_voids_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sale_voids_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sale_void_amounts_nonnegative" CHECK ("amount" >= 0 AND "taxAmount" >= 0 AND "discount" >= 0),
  CONSTRAINT "sale_void_snapshot_arrays" CHECK (jsonb_typeof("items") = 'array' AND jsonb_typeof("tenders") = 'object')
);
CREATE UNIQUE INDEX "sale_voids_saleId_key" ON "sale_voids"("saleId");
CREATE UNIQUE INDEX "sale_voids_idempotencyKey_key" ON "sale_voids"("idempotencyKey");
CREATE INDEX "sale_voids_locationId_createdAt_idx" ON "sale_voids"("locationId", "createdAt");
CREATE FUNCTION protect_sale_void_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sale void events are immutable';
END;
$$;
CREATE TRIGGER sale_voids_immutable BEFORE UPDATE OR DELETE ON sale_voids
FOR EACH ROW EXECUTE FUNCTION protect_sale_void_event();
-- No backfill: the date of an old status-only void cannot be inferred safely.
COMMIT;
