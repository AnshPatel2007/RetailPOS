-- Why a stock change happened (damaged, expired, theft, a count difference, a
-- transfer loss...), kept on the value entry itself so losses can be reported
-- by cause at their cost value.
-- New rows only: this table is append-only, so history is not rewritten. Older
-- rows stay NULL; the loss report reads their cause from the resolved stock
-- exception or the stock log where one exists, and otherwise shows
-- "Reason not recorded". Nullable with no default: nothing can fail on existing rows.
ALTER TABLE "inventory_value_entries" ADD COLUMN "reason" TEXT;
