-- Target-margin pricing rules. Suggested prices round up; prices never change automatically.
-- CreateTable
CREATE TABLE "price_rules" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "targetMargin" DECIMAL(5,4) NOT NULL,
    "minMargin" DECIMAL(5,4),
    "rounding" TEXT NOT NULL DEFAULT 'CENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_rules_locationId_scope_scopeId_key" ON "price_rules"("locationId", "scope", "scopeId");

ALTER TABLE "price_rules"
  ADD CONSTRAINT price_rule_scope CHECK ("scope" IN ('STORE', 'CATEGORY', 'BRAND', 'PRODUCT', 'SELLING_UNIT')),
  ADD CONSTRAINT price_rule_store_default CHECK (("scope" = 'STORE') = ("scopeId" = '')),
  ADD CONSTRAINT price_rule_target_margin CHECK ("targetMargin" >= 0 AND "targetMargin" < 1),
  ADD CONSTRAINT price_rule_min_margin CHECK ("minMargin" IS NULL OR ("minMargin" >= 0 AND "minMargin" < 1)),
  ADD CONSTRAINT price_rule_rounding CHECK ("rounding" IN ('CENT', 'NICKEL', 'NINE', 'NINETY_NINE'));
