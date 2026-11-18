-- AlterTable
ALTER TABLE "lottery_ticket_types" ADD COLUMN     "firstTicket" INTEGER,
ADD COLUMN     "gameNumber" TEXT,
ADD COLUMN     "lastTicket" INTEGER;

-- CreateTable
CREATE TABLE "lottery_configurations" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "effectiveDate" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_books" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "gameNumber" TEXT NOT NULL,
    "bookNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "firstTicket" INTEGER NOT NULL,
    "lastTicket" INTEGER NOT NULL,
    "ticketCount" INTEGER NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "registeredDate" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lottery_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_days" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "recognizedAt" TIMESTAMP(3) NOT NULL,
    "configurationId" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "totals" JSONB,
    "earningsIncomplete" BOOLEAN NOT NULL DEFAULT true,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lottery_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_checkpoints" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "openingPosition" INTEGER NOT NULL,
    "closingPosition" INTEGER,
    "openingVerified" BOOLEAN NOT NULL DEFAULT false,
    "previousStatus" TEXT NOT NULL,
    "disposition" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lossQuantity" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "barcode" TEXT,
    "slot" TEXT NOT NULL,

    CONSTRAINT "lottery_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_settlements" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "reportedEarnings" DECIMAL(14,2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lottery_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_earning_postings" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "dayId" TEXT,
    "settlementId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "recognizedAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_earning_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_audit_events" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "dayId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lottery_configurations_locationId_effectiveDate_key" ON "lottery_configurations"("locationId", "effectiveDate");

-- CreateIndex
CREATE INDEX "lottery_books_locationId_status_idx" ON "lottery_books"("locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_books_locationId_gameNumber_bookNumber_key" ON "lottery_books"("locationId", "gameNumber", "bookNumber");

-- CreateIndex
CREATE INDEX "lottery_days_locationId_recognizedAt_idx" ON "lottery_days"("locationId", "recognizedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_days_locationId_businessDate_key" ON "lottery_days"("locationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_checkpoints_dayId_bookId_key" ON "lottery_checkpoints"("dayId", "bookId");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_settlements_locationId_periodStart_periodEnd_key" ON "lottery_settlements"("locationId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_settlements_locationId_reference_key" ON "lottery_settlements"("locationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_earning_postings_sourceKey_key" ON "lottery_earning_postings"("sourceKey");

-- CreateIndex
CREATE INDEX "lottery_earning_postings_locationId_recognizedAt_idx" ON "lottery_earning_postings"("locationId", "recognizedAt");

-- CreateIndex
CREATE INDEX "lottery_earning_postings_dayId_idx" ON "lottery_earning_postings"("dayId");

-- CreateIndex
CREATE INDEX "lottery_earning_postings_settlementId_idx" ON "lottery_earning_postings"("settlementId");

-- CreateIndex
CREATE INDEX "lottery_audit_events_locationId_createdAt_idx" ON "lottery_audit_events"("locationId", "createdAt");


-- Book positions are boundaries between tickets; position = count means depleted.
ALTER TABLE lottery_books ADD CONSTRAINT lottery_book_bounds CHECK ("firstTicket" >= 0 AND "lastTicket" >= "firstTicket" AND "ticketCount" = "lastTicket" - "firstTicket" + 1 AND position BETWEEN 0 AND "ticketCount" AND price > 0);
ALTER TABLE lottery_checkpoints ADD CONSTRAINT lottery_checkpoint_progress CHECK ("openingPosition" >= 0 AND ("closingPosition" IS NULL OR "closingPosition" >= "openingPosition") AND "lossQuantity" >= 0);
CREATE FUNCTION prevent_lottery_fact_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Lottery accounting facts are immutable; append a correction'; END $$;
CREATE TRIGGER lottery_earnings_immutable BEFORE UPDATE OR DELETE ON lottery_earning_postings FOR EACH ROW EXECUTE FUNCTION prevent_lottery_fact_change();
CREATE TRIGGER lottery_audit_immutable BEFORE UPDATE OR DELETE ON lottery_audit_events FOR EACH ROW EXECUTE FUNCTION prevent_lottery_fact_change();

