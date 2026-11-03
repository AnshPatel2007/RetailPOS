-- Public document references use a global, concurrency-safe sequence. UUID
-- primary keys and existing references remain unchanged. Gaps are intentional:
-- rollbacks and abandoned requests never reuse a reserved number.
CREATE SEQUENCE "document_reference_seq" AS BIGINT START WITH 100001;

-- Keep scheduler deduplication separate from the number printed for the user.
ALTER TABLE "expenses" ADD COLUMN "referenceKey" TEXT;
CREATE UNIQUE INDEX "expenses_referenceKey_key" ON "expenses"("referenceKey");

SELECT setval('document_reference_seq', GREATEST(100000, COALESCE(MAX(substring(reference FROM '([0-9]+)$')::bigint), 0)))
FROM (
  SELECT "saleNumber" AS reference FROM "sales"
  UNION ALL SELECT "orderNumber" FROM "purchase_orders"
  UNION ALL SELECT "expenseNumber" FROM "expenses"
  UNION ALL SELECT "countNumber" FROM "cycle_counts"
  UNION ALL SELECT "transferNumber" FROM "inventory_transfers"
  UNION ALL SELECT "exchangeNumber" FROM "exchanges"
) existing
WHERE reference ~ '^(S-[0-9]{6}|PO|INV|EXP|EX|CC|TRF)-[0-9]{1,18}$';
