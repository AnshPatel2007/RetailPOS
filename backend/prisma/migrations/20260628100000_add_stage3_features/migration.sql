-- CreateEnum
CREATE TYPE "LotteryBatchStatus" AS ENUM ('ACTIVE', 'DEPLETED', 'RETURNED');
CREATE TYPE "LotteryTransactionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable: gift_cards
CREATE TABLE "gift_cards" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "initialBalance" DOUBLE PRECISION NOT NULL,
    "currentBalance" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gift_cards_code_key" ON "gift_cards"("code");
CREATE INDEX "gift_cards_code_idx" ON "gift_cards"("code");
CREATE INDEX "gift_cards_customerId_idx" ON "gift_cards"("customerId");

-- CreateTable: gift_card_transactions
CREATE TABLE "gift_card_transactions" (
    "id" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceBefore" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "saleId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gift_card_transactions_giftCardId_idx" ON "gift_card_transactions"("giftCardId");
CREATE INDEX "gift_card_transactions_saleId_idx" ON "gift_card_transactions"("saleId");

-- CreateTable: store_credit_accounts
CREATE TABLE "store_credit_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_credit_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_credit_accounts_customerId_key" ON "store_credit_accounts"("customerId");

-- CreateTable: store_credit_transactions
CREATE TABLE "store_credit_transactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceBefore" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "saleId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_credit_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "store_credit_transactions_accountId_idx" ON "store_credit_transactions"("accountId");
CREATE INDEX "store_credit_transactions_saleId_idx" ON "store_credit_transactions"("saleId");

-- CreateTable: exchanges
CREATE TABLE "exchanges" (
    "id" TEXT NOT NULL,
    "exchangeNumber" TEXT NOT NULL,
    "originalSaleId" TEXT NOT NULL,
    "newSaleId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "returnedItems" JSONB NOT NULL,
    "priceDifference" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "processedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchanges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exchanges_exchangeNumber_key" ON "exchanges"("exchangeNumber");
CREATE INDEX "exchanges_originalSaleId_idx" ON "exchanges"("originalSaleId");
CREATE INDEX "exchanges_exchangeNumber_idx" ON "exchanges"("exchangeNumber");

-- CreateTable: inventory_transfers
CREATE TABLE "inventory_transfers" (
    "id" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "shippedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_transfers_transferNumber_key" ON "inventory_transfers"("transferNumber");
CREATE INDEX "inventory_transfers_fromLocationId_idx" ON "inventory_transfers"("fromLocationId");
CREATE INDEX "inventory_transfers_toLocationId_idx" ON "inventory_transfers"("toLocationId");
CREATE INDEX "inventory_transfers_status_idx" ON "inventory_transfers"("status");

-- CreateTable: transfer_items
CREATE TABLE "transfer_items" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transfer_items_transferId_idx" ON "transfer_items"("transferId");
CREATE INDEX "transfer_items_productId_idx" ON "transfer_items"("productId");

-- CreateTable: cycle_counts
CREATE TABLE "cycle_counts" (
    "id" TEXT NOT NULL,
    "countNumber" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "type" TEXT NOT NULL DEFAULT 'FULL',
    "categoryId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_counts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cycle_counts_countNumber_key" ON "cycle_counts"("countNumber");
CREATE INDEX "cycle_counts_locationId_idx" ON "cycle_counts"("locationId");
CREATE INDEX "cycle_counts_status_idx" ON "cycle_counts"("status");

-- CreateTable: cycle_count_items
CREATE TABLE "cycle_count_items" (
    "id" TEXT NOT NULL,
    "cycleCountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER,
    "discrepancy" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_count_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cycle_count_items_cycleCountId_idx" ON "cycle_count_items"("cycleCountId");
CREATE INDEX "cycle_count_items_productId_idx" ON "cycle_count_items"("productId");

-- CreateTable: lottery_batches
CREATE TABLE "lottery_batches" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "startTicketNum" TEXT NOT NULL,
    "endTicketNum" TEXT NOT NULL,
    "totalTickets" INTEGER NOT NULL,
    "remainingTickets" INTEGER NOT NULL,
    "pricePerTicket" DOUBLE PRECISION NOT NULL,
    "status" "LotteryBatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "activatedAt" TIMESTAMP(3),
    "depletedAt" TIMESTAMP(3),
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lottery_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lottery_batches_locationId_idx" ON "lottery_batches"("locationId");
CREATE INDEX "lottery_batches_batchNumber_idx" ON "lottery_batches"("batchNumber");

-- CreateTable: lottery_transactions
CREATE TABLE "lottery_transactions" (
    "id" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "onlineSalesCount" INTEGER NOT NULL DEFAULT 0,
    "onlineSalesAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "offlineSalesCount" INTEGER NOT NULL DEFAULT 0,
    "offlineSalesAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashoutAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "LotteryTransactionStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lottery_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lottery_transactions_transactionDate_locationId_key" ON "lottery_transactions"("transactionDate", "locationId");
CREATE INDEX "lottery_transactions_locationId_idx" ON "lottery_transactions"("locationId");
CREATE INDEX "lottery_transactions_transactionDate_idx" ON "lottery_transactions"("transactionDate");

-- CreateTable: lottery_ticket_scans
CREATE TABLE "lottery_ticket_scans" (
    "id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "ticketNumber" TEXT,
    "gameType" TEXT,
    "amount" DOUBLE PRECISION,
    "notes" TEXT,
    "batchId" TEXT,
    "transactionId" TEXT,
    "userId" TEXT NOT NULL,
    "locationId" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_ticket_scans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lottery_ticket_scans_batchId_idx" ON "lottery_ticket_scans"("batchId");
CREATE INDEX "lottery_ticket_scans_transactionId_idx" ON "lottery_ticket_scans"("transactionId");
CREATE INDEX "lottery_ticket_scans_locationId_idx" ON "lottery_ticket_scans"("locationId");

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_credit_accounts" ADD CONSTRAINT "store_credit_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_credit_transactions" ADD CONSTRAINT "store_credit_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "store_credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "inventory_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_cycleCountId_fkey" FOREIGN KEY ("cycleCountId") REFERENCES "cycle_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lottery_batches" ADD CONSTRAINT "lottery_batches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lottery_batches" ADD CONSTRAINT "lottery_batches_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lottery_transactions" ADD CONSTRAINT "lottery_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lottery_transactions" ADD CONSTRAINT "lottery_transactions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lottery_ticket_scans" ADD CONSTRAINT "lottery_ticket_scans_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "lottery_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lottery_ticket_scans" ADD CONSTRAINT "lottery_ticket_scans_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "lottery_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lottery_ticket_scans" ADD CONSTRAINT "lottery_ticket_scans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lottery_ticket_scans" ADD CONSTRAINT "lottery_ticket_scans_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
