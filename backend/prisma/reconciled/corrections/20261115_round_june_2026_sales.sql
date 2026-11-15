-- One-time correction for the live installation, reviewed Nov 15, 2026. Run it BEFORE the bridge
-- (DATABASE_MIGRATIONS.md, "Upgrading the Render installation"); the database is then still in its
-- July state, with no triggers on sales.
--
-- Two cash test sales from June 28, 2026, booked before the July 2026 money-rounding fix, stored their
-- tax, total and change with floating-point residue (tax computed at 8.875% and never rounded). The
-- fixed-precision migration 20261017000000 refuses such amounts for review. Reviewed: rounded to the
-- cent they are exactly what was charged, and nothing else refers to them (no payment rows, shift or
-- customer):
--   SALE-20260628-0001: 0.91 + tax 0.08 = 0.99, cash paid 1.00, change 0.01
--   SALE-20260628-0002: 1.81 + tax 0.16 = 1.97, cash paid 1.97, change 0.00
--
-- It changes nothing unless the data is exactly as reviewed, records each change in activity_logs
-- (action LEGACY_SALE_ROUNDED, with the before and after amounts), and does nothing when run again.
BEGIN;
DO $$
DECLARE
  pending_sales integer;
  pending_lines integer;
  reviewed_sales integer;
  reviewed_lines integer;
BEGIN
  SELECT count(*) INTO pending_sales FROM sales
   WHERE abs(tax::numeric - round(tax::numeric, 2)) > 0.000001 OR abs(total::numeric - round(total::numeric, 2)) > 0.000001
      OR abs("changeDue"::numeric - round("changeDue"::numeric, 2)) > 0.000001;
  SELECT count(*) INTO pending_lines FROM sale_items
   WHERE abs(tax::numeric - round(tax::numeric, 2)) > 0.000001 OR abs(total::numeric - round(total::numeric, 2)) > 0.000001;
  IF pending_sales = 0 AND pending_lines = 0 THEN
    RAISE NOTICE 'No legacy sale needs rounding. Nothing was changed.';
    RETURN;
  END IF;

  SELECT count(*) INTO reviewed_sales FROM sales
   WHERE ("saleNumber" = 'SALE-20260628-0001' AND abs(subtotal - 0.91) < 1e-9 AND abs(tax - 0.0807625) < 1e-9
          AND abs(total - 0.9907625) < 1e-9 AND abs("amountPaid" - 1) < 1e-9)
      OR ("saleNumber" = 'SALE-20260628-0002' AND abs(subtotal - 1.81) < 1e-9 AND abs(tax - 0.1606375) < 1e-9
          AND abs(total - 1.9706375) < 1e-9 AND abs("amountPaid" - 1.97) < 1e-9);
  SELECT count(*) INTO reviewed_lines FROM sale_items i JOIN sales s ON s.id = i."saleId"
   WHERE s."saleNumber" IN ('SALE-20260628-0001', 'SALE-20260628-0002')
     AND abs(i.tax::numeric - round(i.tax::numeric, 2)) > 0.000001 AND abs(i.total - s.total) < 1e-9;
  IF pending_sales <> 2 OR reviewed_sales <> 2 OR pending_lines <> 2 OR reviewed_lines <> 2 THEN
    RAISE EXCEPTION 'Legacy sales differ from the two reviewed on Nov 15, 2026 (% sales and % lines need rounding). Nothing was changed; review them first.',
      pending_sales, pending_lines;
  END IF;

  INSERT INTO activity_logs (id, action, entity, "entityId", "locationId", details)
  SELECT gen_random_uuid()::text, 'LEGACY_SALE_ROUNDED', 'SALE', s.id, s."locationId",
    jsonb_build_object('saleNumber', s."saleNumber",
      'reason', 'Booked before the July 2026 money-rounding fix with fractions of a cent; rounded to what was charged before the fixed-precision upgrade (reviewed Nov 15, 2026).',
      'before', jsonb_build_object('tax', s.tax, 'total', s.total, 'changeDue', s."changeDue"),
      'after', jsonb_build_object('tax', round(s.tax::numeric, 2), 'total', round(s.total::numeric, 2), 'changeDue', round(s."changeDue"::numeric, 2) + 0))
  FROM sales s WHERE s."saleNumber" IN ('SALE-20260628-0001', 'SALE-20260628-0002');

  UPDATE sale_items i SET tax = round(i.tax::numeric, 2), total = round(i.total::numeric, 2)
    FROM sales s WHERE s.id = i."saleId" AND s."saleNumber" IN ('SALE-20260628-0001', 'SALE-20260628-0002');
  UPDATE sales SET tax = round(tax::numeric, 2), total = round(total::numeric, 2), "changeDue" = round("changeDue"::numeric, 2) + 0
   WHERE "saleNumber" IN ('SALE-20260628-0001', 'SALE-20260628-0002');
  RAISE NOTICE 'Rounded the two reviewed June 28, 2026 sales to the cent and recorded each in activity_logs.';
END $$;
COMMIT;
