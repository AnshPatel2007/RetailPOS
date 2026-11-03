ALTER TABLE sale_voids ALTER COLUMN "costReversed" TYPE DECIMAL(24,8);
ALTER TABLE refund_items ALTER COLUMN "costReturned" TYPE DECIMAL(24,8);

-- Read projection only. Original cost facts and every approved revision remain immutable.
CREATE VIEW effective_inventory_values AS
SELECT e.id, e.sequence, e."productId", e."locationId", e."userId", e.kind, e.mode,
 e."sourceId", e."sourceKey", e.quantity, e."quantityBefore", e."quantityAfter",
 CASE WHEN r.id IS NULL THEN e."inputValue" ELSE r."inputValue" END AS "inputValue",
 CASE WHEN r.id IS NULL THEN e."valueBefore" ELSE r."valueBefore" END AS "valueBefore",
 CASE WHEN r.id IS NULL THEN e."valueChange" ELSE r."valueChange" END AS "valueChange",
 CASE WHEN r.id IS NULL THEN e."valueAfter" ELSE r."valueAfter" END AS "valueAfter",
 CASE WHEN r.id IS NULL THEN e."cogsAmount" ELSE r."cogsAmount" END AS "cogsAmount",
 e."cogsAmount" AS "bookedCogs", r."correctionId", e."referenceEntryId", e."referenceQuantity", e."referenceOffset",
 e.notes, e."effectiveAt", e."createdAt"
FROM inventory_value_entries e
LEFT JOIN LATERAL (SELECT * FROM inventory_cost_revisions r WHERE r."entryId" = e.id ORDER BY r.sequence DESC LIMIT 1) r ON TRUE;
