-- Physical stores sell what the customer holds. Recorded stock may go negative;
-- every sale still receives a cost treatment (verified, estimated or unknown).

CREATE TYPE "CostStatus" AS ENUM ('VERIFIED', 'ESTIMATED', 'UNKNOWN');

-- Negative balances are allowed. Quantity arithmetic must still balance.
ALTER TABLE inventory_valuations DROP CONSTRAINT inventory_balance_nonnegative;
ALTER TABLE inventory_value_entries DROP CONSTRAINT inventory_entry_quantities;
ALTER TABLE inventory_value_entries ADD CONSTRAINT inventory_entry_quantities
  CHECK ("quantityBefore" + quantity = "quantityAfter");
-- A non-negative balance can never carry a negative value; a negative balance
-- carries a non-positive (provisional) value.
ALTER TABLE inventory_valuations ADD CONSTRAINT inventory_balance_value_sign
  CHECK (value IS NULL OR (quantity >= 0 AND value >= 0) OR (quantity < 0 AND value <= 0));

ALTER TABLE inventory_valuations ADD COLUMN "lastUnitCost" DECIMAL(24,8);
ALTER TABLE inventory_value_entries ADD COLUMN "costStatus" "CostStatus" NOT NULL DEFAULT 'VERIFIED';
ALTER TABLE sale_items ADD COLUMN "costStatus" "CostStatus" NOT NULL DEFAULT 'VERIFIED';
ALTER TABLE products ADD COLUMN "provisionalUnitCost" DECIMAL(14,4), ADD COLUMN "saleBlockedReason" TEXT;

-- Seed the last known unit cost from current positive, valued balances.
UPDATE inventory_valuations SET "lastUnitCost" = ROUND(value / quantity, 8)
  WHERE quantity > 0 AND value IS NOT NULL AND value > 0;

-- Historical records without a cost were unknown, not verified. The immutability
-- trigger guards cost facts; this classification column is added by this
-- migration, so the backfill runs with the trigger briefly disabled.
ALTER TABLE inventory_value_entries DISABLE TRIGGER inventory_value_immutable;
UPDATE inventory_value_entries SET "costStatus" = 'UNKNOWN'
  WHERE "cogsAmount" IS NULL AND kind IN ('SALE', 'OFFLINE_SALE', 'RETURN', 'VOID_RETURN');
ALTER TABLE inventory_value_entries ENABLE TRIGGER inventory_value_immutable;
UPDATE sale_items SET "costStatus" = 'UNKNOWN' WHERE "costAmount" IS NULL AND "unitCost" IS NULL;

-- Cost corrections that change an already-booked cost are recognized in the
-- period they are confirmed: a COST_CORRECTION entry carries the COGS
-- difference. effective_inventory_values keeps every revision (inventory
-- valuation, goods in transit and replay need corrected quantities and values);
-- reported_inventory_values overlays only RESTATED revisions (missing costs
-- filled in their original period) and is the source for P&L period figures.
-- Corrections recorded before this migration keep their restatement.
ALTER TABLE inventory_cost_corrections ADD COLUMN recognition TEXT NOT NULL DEFAULT 'RESTATED';
CREATE VIEW reported_inventory_values AS
SELECT e.id, e.sequence, e."productId", e."locationId", e."userId", e.kind, e.mode,
 e."sourceId", e."sourceKey", e.quantity, e."quantityBefore", e."quantityAfter",
 CASE WHEN r.id IS NULL THEN e."inputValue" ELSE r."inputValue" END AS "inputValue",
 CASE WHEN r.id IS NULL THEN e."valueBefore" ELSE r."valueBefore" END AS "valueBefore",
 CASE WHEN r.id IS NULL THEN e."valueChange" ELSE r."valueChange" END AS "valueChange",
 CASE WHEN r.id IS NULL THEN e."valueAfter" ELSE r."valueAfter" END AS "valueAfter",
 CASE WHEN r.id IS NULL THEN e."cogsAmount" ELSE r."cogsAmount" END AS "cogsAmount",
 e."cogsAmount" AS "bookedCogs", r."correctionId", e."referenceEntryId", e."referenceQuantity", e."referenceOffset",
 e.notes, e."effectiveAt", e."createdAt", e."costStatus"
FROM inventory_value_entries e
LEFT JOIN LATERAL (SELECT r.* FROM inventory_cost_revisions r
  JOIN inventory_cost_corrections c ON c.id = r."correctionId" AND c.recognition = 'RESTATED'
  WHERE r."entryId" = e.id ORDER BY r.sequence DESC LIMIT 1) r ON TRUE;
