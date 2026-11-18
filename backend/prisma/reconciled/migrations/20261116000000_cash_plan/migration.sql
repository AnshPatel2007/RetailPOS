-- Money Ahead: the owner's look at the store's money over the next 14 days.
-- Purely additive: two new tables, nothing existing changes.

-- The owner's own facts that records cannot know: how long card money takes to
-- reach the bank and its fee, when sales tax is paid, the lottery's sweep day,
-- and the money the business had this morning. One row per store, owner-only,
-- kept out of the store settings every register receives.
CREATE TABLE "cash_plan_settings" (
  "locationId" TEXT NOT NULL,
  "cardDepositDays" INTEGER NOT NULL DEFAULT 2,
  "cardFeePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "salesTaxFrequency" TEXT NOT NULL DEFAULT 'NONE',
  "salesTaxDueDay" INTEGER NOT NULL DEFAULT 20,
  "lotterySweepWeekday" INTEGER,
  "startingMoney" DECIMAL(14,2),
  "startingMoneyDate" TEXT,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cash_plan_settings_pkey" PRIMARY KEY ("locationId")
);
ALTER TABLE "cash_plan_settings" ADD CONSTRAINT "cash_plan_settings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Money the owner expects that no record shows: once, weekly or monthly.
CREATE TABLE "cash_plan_items" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "repeat" TEXT NOT NULL,
  "date" TEXT,
  "weekday" INTEGER,
  "dayOfMonth" INTEGER,
  "endsOn" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cash_plan_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cash_plan_items_locationId_isActive_idx" ON "cash_plan_items"("locationId", "isActive");
ALTER TABLE "cash_plan_items" ADD CONSTRAINT "cash_plan_items_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
