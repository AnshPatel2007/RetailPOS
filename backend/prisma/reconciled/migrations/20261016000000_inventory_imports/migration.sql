BEGIN;
CREATE TABLE "inventory_imports" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "preview" JSONB NOT NULL,
  "result" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_imports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inventory_imports_locationId_userId_createdAt_idx" ON "inventory_imports"("locationId", "userId", "createdAt");
CREATE FUNCTION protect_applied_inventory_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."appliedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Applied inventory imports are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['result', 'appliedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['result', 'appliedAt']) THEN
    RAISE EXCEPTION 'Inventory import previews cannot be changed';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_imports_immutable BEFORE UPDATE OR DELETE ON inventory_imports
FOR EACH ROW EXECUTE FUNCTION protect_applied_inventory_import();
COMMIT;
