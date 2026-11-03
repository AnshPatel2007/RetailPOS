CREATE TABLE operation_receipts (
  id TEXT PRIMARY KEY, "idempotencyKey" TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL, "targetId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "locationId" TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestHash" TEXT NOT NULL, result JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX operation_receipts_scope_idx ON operation_receipts("locationId",kind,"createdAt",id);
CREATE INDEX operation_receipts_target_idx ON operation_receipts("targetId");
CREATE FUNCTION protect_operation_receipt() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Operation receipts are immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER operation_receipts_immutable BEFORE UPDATE OR DELETE ON operation_receipts
FOR EACH ROW EXECUTE FUNCTION protect_operation_receipt();
