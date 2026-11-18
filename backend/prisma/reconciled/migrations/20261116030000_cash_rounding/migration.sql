-- Cash rounding to 5 cents (Settings > Taxes & Payments; off unless the owner chooses
-- it). Purely additive: two columns with a default, so every existing sale and refund
-- reads 0 and nothing is rewritten. Apply BEFORE starting an API on this version: its
-- client reads these columns on every sale and refund.

-- The rounding on the cash that finished a sale (negative: the store took less). The
-- sale's total, tax and lines stay exact.
ALTER TABLE "sales" ADD COLUMN "cashRounding" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- The rounding on the cash a refund paid back (payout = its cash tenders + this). The
-- refund's amount and tender allocations stay exact.
ALTER TABLE "refunds" ADD COLUMN "cashRounding" DECIMAL(14,2) NOT NULL DEFAULT 0;
