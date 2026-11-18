ALTER TABLE "lottery_ticket_types"
  ADD COLUMN "binNumber" TEXT,
  ADD COLUMN "startingNumber" INTEGER,
  ADD COLUMN "countDirection" TEXT NOT NULL DEFAULT 'ASC';
