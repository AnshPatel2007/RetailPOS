BEGIN;

-- Old transactions keep their original balances. Their unknown funding method,
-- reference and paying drawer are not backfilled or guessed.
-- DropForeignKey
ALTER TABLE "gift_card_transactions" DROP CONSTRAINT "gift_card_transactions_giftCardId_fkey";

-- DropForeignKey
ALTER TABLE "store_credit_transactions" DROP CONSTRAINT "store_credit_transactions_accountId_fkey";

-- DropForeignKey
ALTER TABLE "house_account_transactions" DROP CONSTRAINT "house_account_transactions_accountId_fkey";

-- AlterTable
ALTER TABLE "gift_card_transactions" ADD COLUMN     "operationId" TEXT;

-- AlterTable
ALTER TABLE "store_credit_transactions" ADD COLUMN     "operationId" TEXT;

-- AlterTable
ALTER TABLE "house_account_transactions" ADD COLUMN     "operationId" TEXT;

-- AlterTable
ALTER TABLE "drawer_entries" ADD COLUMN     "accountOperationId" TEXT;

-- CreateTable
CREATE TABLE "account_operations" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceBefore" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "reason" TEXT,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "shiftId" TEXT,
    "giftCardId" TEXT,
    "storeCreditAccountId" TEXT,
    "houseAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_operations_idempotencyKey_key" ON "account_operations"("idempotencyKey");

-- CreateIndex
CREATE INDEX "account_operations_locationId_createdAt_idx" ON "account_operations"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "account_operations_giftCardId_idx" ON "account_operations"("giftCardId");

-- CreateIndex
CREATE INDEX "account_operations_storeCreditAccountId_idx" ON "account_operations"("storeCreditAccountId");

-- CreateIndex
CREATE INDEX "account_operations_houseAccountId_idx" ON "account_operations"("houseAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_transactions_operationId_key" ON "gift_card_transactions"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "store_credit_transactions_operationId_key" ON "store_credit_transactions"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "house_account_transactions_operationId_key" ON "house_account_transactions"("operationId");

-- AddForeignKey
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "account_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_credit_transactions" ADD CONSTRAINT "store_credit_transactions_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "account_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_credit_transactions" ADD CONSTRAINT "store_credit_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "store_credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_account_transactions" ADD CONSTRAINT "house_account_transactions_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "account_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_account_transactions" ADD CONSTRAINT "house_account_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "house_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_storeCreditAccountId_fkey" FOREIGN KEY ("storeCreditAccountId") REFERENCES "store_credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_houseAccountId_fkey" FOREIGN KEY ("houseAccountId") REFERENCES "house_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawer_entries" ADD CONSTRAINT "drawer_entries_accountOperationId_fkey" FOREIGN KEY ("accountOperationId") REFERENCES "account_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE account_operations ADD CONSTRAINT account_operation_amount_positive CHECK (amount > 0);
ALTER TABLE account_operations ADD CONSTRAINT account_operation_target CHECK (
  num_nonnulls("giftCardId", "storeCreditAccountId", "houseAccountId") = 1
  AND ((kind IN ('GIFT_ISSUE', 'GIFT_RELOAD') AND "giftCardId" IS NOT NULL)
    OR (kind = 'STORE_CREDIT' AND "storeCreditAccountId" IS NOT NULL)
    OR (kind = 'HOUSE_PAYMENT' AND "houseAccountId" IS NOT NULL))
);
CREATE FUNCTION protect_account_operations() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Account operation receipts are immutable; record a separate correction';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER account_operations_immutable BEFORE UPDATE OR DELETE ON account_operations
FOR EACH ROW EXECUTE FUNCTION protect_account_operations();

COMMIT;

