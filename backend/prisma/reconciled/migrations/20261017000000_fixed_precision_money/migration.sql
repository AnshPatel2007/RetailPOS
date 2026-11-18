-- Convert booked USD to cents and unit prices/costs/rates to four places.
-- Refuse meaningful precision loss or non-finite legacy data; review it explicitly.
-- The transaction preserves existing rows, migration history and immutable triggers.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "hourlyRate" IS NOT NULL AND ("hourlyRate"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("hourlyRate"::numeric - round("hourlyRate"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for users.hourlyRate; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "locations" WHERE "taxRate" IS NOT NULL AND ("taxRate"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("taxRate"::numeric - round("taxRate"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for locations.taxRate; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "locations" WHERE "cardSurchargePercent" IS NOT NULL AND ("cardSurchargePercent"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("cardSurchargePercent"::numeric - round("cardSurchargePercent"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for locations.cardSurchargePercent; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "products" WHERE "cost" IS NOT NULL AND ("cost"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("cost"::numeric - round("cost"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for products.cost; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "products" WHERE "price" IS NOT NULL AND ("price"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("price"::numeric - round("price"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for products.price; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "products" WHERE "compareAtPrice" IS NOT NULL AND ("compareAtPrice"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("compareAtPrice"::numeric - round("compareAtPrice"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for products.compareAtPrice; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "product_variants" WHERE "price" IS NOT NULL AND ("price"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("price"::numeric - round("price"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for product_variants.price; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "product_variants" WHERE "cost" IS NOT NULL AND ("cost"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("cost"::numeric - round("cost"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for product_variants.cost; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "suppliers" WHERE "minimumOrder" IS NOT NULL AND ("minimumOrder"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("minimumOrder"::numeric - round("minimumOrder"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for suppliers.minimumOrder; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "product_suppliers" WHERE "cost" IS NOT NULL AND ("cost"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("cost"::numeric - round("cost"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for product_suppliers.cost; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "purchase_orders" WHERE "totalAmount" IS NOT NULL AND ("totalAmount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("totalAmount"::numeric - round("totalAmount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for purchase_orders.totalAmount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "purchase_order_items" WHERE "cost" IS NOT NULL AND ("cost"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("cost"::numeric - round("cost"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for purchase_order_items.cost; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "purchase_order_items" WHERE "total" IS NOT NULL AND ("total"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("total"::numeric - round("total"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for purchase_order_items.total; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sales" WHERE "subtotal" IS NOT NULL AND ("subtotal"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("subtotal"::numeric - round("subtotal"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sales.subtotal; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sales" WHERE "tax" IS NOT NULL AND ("tax"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("tax"::numeric - round("tax"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sales.tax; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sales" WHERE "discount" IS NOT NULL AND ("discount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("discount"::numeric - round("discount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sales.discount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sales" WHERE "surcharge" IS NOT NULL AND ("surcharge"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("surcharge"::numeric - round("surcharge"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sales.surcharge; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sales" WHERE "total" IS NOT NULL AND ("total"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("total"::numeric - round("total"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sales.total; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sales" WHERE "amountPaid" IS NOT NULL AND ("amountPaid"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amountPaid"::numeric - round("amountPaid"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sales.amountPaid; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sales" WHERE "changeDue" IS NOT NULL AND ("changeDue"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("changeDue"::numeric - round("changeDue"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sales.changeDue; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sale_items" WHERE "price" IS NOT NULL AND ("price"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("price"::numeric - round("price"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sale_items.price; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sale_items" WHERE "discount" IS NOT NULL AND ("discount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("discount"::numeric - round("discount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sale_items.discount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sale_items" WHERE "tax" IS NOT NULL AND ("tax"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("tax"::numeric - round("tax"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sale_items.tax; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sale_items" WHERE "total" IS NOT NULL AND ("total"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("total"::numeric - round("total"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sale_items.total; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sale_items" WHERE "promotionDiscount" IS NOT NULL AND ("promotionDiscount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("promotionDiscount"::numeric - round("promotionDiscount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sale_items.promotionDiscount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "sale_payments" WHERE "amount" IS NOT NULL AND ("amount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amount"::numeric - round("amount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for sale_payments.amount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "refunds" WHERE "amount" IS NOT NULL AND ("amount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amount"::numeric - round("amount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for refunds.amount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "refund_items" WHERE "amount" IS NOT NULL AND ("amount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amount"::numeric - round("amount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for refund_items.amount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "customers" WHERE "totalSpent" IS NOT NULL AND ("totalSpent"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("totalSpent"::numeric - round("totalSpent"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for customers.totalSpent; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "gift_cards" WHERE "initialBalance" IS NOT NULL AND ("initialBalance"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("initialBalance"::numeric - round("initialBalance"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for gift_cards.initialBalance; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "gift_cards" WHERE "currentBalance" IS NOT NULL AND ("currentBalance"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("currentBalance"::numeric - round("currentBalance"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for gift_cards.currentBalance; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "gift_card_transactions" WHERE "amount" IS NOT NULL AND ("amount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amount"::numeric - round("amount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for gift_card_transactions.amount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "gift_card_transactions" WHERE "balanceBefore" IS NOT NULL AND ("balanceBefore"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("balanceBefore"::numeric - round("balanceBefore"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for gift_card_transactions.balanceBefore; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "gift_card_transactions" WHERE "balanceAfter" IS NOT NULL AND ("balanceAfter"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("balanceAfter"::numeric - round("balanceAfter"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for gift_card_transactions.balanceAfter; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "store_credit_accounts" WHERE "balance" IS NOT NULL AND ("balance"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("balance"::numeric - round("balance"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for store_credit_accounts.balance; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "store_credit_transactions" WHERE "amount" IS NOT NULL AND ("amount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amount"::numeric - round("amount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for store_credit_transactions.amount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "store_credit_transactions" WHERE "balanceBefore" IS NOT NULL AND ("balanceBefore"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("balanceBefore"::numeric - round("balanceBefore"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for store_credit_transactions.balanceBefore; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "store_credit_transactions" WHERE "balanceAfter" IS NOT NULL AND ("balanceAfter"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("balanceAfter"::numeric - round("balanceAfter"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for store_credit_transactions.balanceAfter; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "house_accounts" WHERE "creditLimit" IS NOT NULL AND ("creditLimit"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("creditLimit"::numeric - round("creditLimit"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for house_accounts.creditLimit; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "house_accounts" WHERE "balance" IS NOT NULL AND ("balance"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("balance"::numeric - round("balance"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for house_accounts.balance; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "house_account_transactions" WHERE "amount" IS NOT NULL AND ("amount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amount"::numeric - round("amount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for house_account_transactions.amount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "house_account_transactions" WHERE "balanceBefore" IS NOT NULL AND ("balanceBefore"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("balanceBefore"::numeric - round("balanceBefore"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for house_account_transactions.balanceBefore; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "house_account_transactions" WHERE "balanceAfter" IS NOT NULL AND ("balanceAfter"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("balanceAfter"::numeric - round("balanceAfter"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for house_account_transactions.balanceAfter; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "exchanges" WHERE "priceDifference" IS NOT NULL AND ("priceDifference"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("priceDifference"::numeric - round("priceDifference"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for exchanges.priceDifference; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "shifts" WHERE "hourlyRate" IS NOT NULL AND ("hourlyRate"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("hourlyRate"::numeric - round("hourlyRate"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for shifts.hourlyRate; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "shifts" WHERE "startingCash" IS NOT NULL AND ("startingCash"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("startingCash"::numeric - round("startingCash"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for shifts.startingCash; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "shifts" WHERE "endingCash" IS NOT NULL AND ("endingCash"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("endingCash"::numeric - round("endingCash"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for shifts.endingCash; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "shifts" WHERE "expectedCash" IS NOT NULL AND ("expectedCash"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("expectedCash"::numeric - round("expectedCash"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for shifts.expectedCash; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "shifts" WHERE "cashDifference" IS NOT NULL AND ("cashDifference"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("cashDifference"::numeric - round("cashDifference"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for shifts.cashDifference; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "shifts" WHERE "totalSales" IS NOT NULL AND ("totalSales"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("totalSales"::numeric - round("totalSales"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for shifts.totalSales; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "cash_movements" WHERE "amount" IS NOT NULL AND ("amount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amount"::numeric - round("amount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for cash_movements.amount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "expenses" WHERE "amount" IS NOT NULL AND ("amount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amount"::numeric - round("amount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for expenses.amount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "discounts" WHERE "value" IS NOT NULL AND ("value"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("value"::numeric - round("value"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for discounts.value; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "discounts" WHERE "minPurchase" IS NOT NULL AND ("minPurchase"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("minPurchase"::numeric - round("minPurchase"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for discounts.minPurchase; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "discounts" WHERE "maxDiscount" IS NOT NULL AND ("maxDiscount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("maxDiscount"::numeric - round("maxDiscount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for discounts.maxDiscount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "promotions" WHERE "bundlePrice" IS NOT NULL AND ("bundlePrice"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("bundlePrice"::numeric - round("bundlePrice"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for promotions.bundlePrice; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "promotions" WHERE "percentOff" IS NOT NULL AND ("percentOff"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("percentOff"::numeric - round("percentOff"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for promotions.percentOff; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "promotions" WHERE "amountOff" IS NOT NULL AND ("amountOff"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amountOff"::numeric - round("amountOff"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for promotions.amountOff; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "budgets" WHERE "amount" IS NOT NULL AND ("amount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amount"::numeric - round("amount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for budgets.amount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "budgets" WHERE "alertAt" IS NOT NULL AND ("alertAt"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("alertAt"::numeric - round("alertAt"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for budgets.alertAt; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "recurring_expenses" WHERE "amount" IS NOT NULL AND ("amount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amount"::numeric - round("amount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for recurring_expenses.amount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_batches" WHERE "pricePerTicket" IS NOT NULL AND ("pricePerTicket"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("pricePerTicket"::numeric - round("pricePerTicket"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_batches.pricePerTicket; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_transactions" WHERE "onlineSalesAmount" IS NOT NULL AND ("onlineSalesAmount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("onlineSalesAmount"::numeric - round("onlineSalesAmount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_transactions.onlineSalesAmount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_transactions" WHERE "offlineSalesAmount" IS NOT NULL AND ("offlineSalesAmount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("offlineSalesAmount"::numeric - round("offlineSalesAmount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_transactions.offlineSalesAmount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_transactions" WHERE "cashoutAmount" IS NOT NULL AND ("cashoutAmount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("cashoutAmount"::numeric - round("cashoutAmount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_transactions.cashoutAmount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_transactions" WHERE "netAmount" IS NOT NULL AND ("netAmount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("netAmount"::numeric - round("netAmount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_transactions.netAmount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_ticket_scans" WHERE "amount" IS NOT NULL AND ("amount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("amount"::numeric - round("amount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_ticket_scans.amount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_ticket_types" WHERE "pricePerTicket" IS NOT NULL AND ("pricePerTicket"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("pricePerTicket"::numeric - round("pricePerTicket"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_ticket_types.pricePerTicket; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_daily_entries" WHERE "pricePerTicket" IS NOT NULL AND ("pricePerTicket"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("pricePerTicket"::numeric - round("pricePerTicket"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_daily_entries.pricePerTicket; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_daily_entries" WHERE "totalSales" IS NOT NULL AND ("totalSales"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("totalSales"::numeric - round("totalSales"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_daily_entries.totalSales; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_day_statuses" WHERE "totalSales" IS NOT NULL AND ("totalSales"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("totalSales"::numeric - round("totalSales"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_day_statuses.totalSales; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_day_statuses" WHERE "manualCashoutAmount" IS NOT NULL AND ("manualCashoutAmount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("manualCashoutAmount"::numeric - round("manualCashoutAmount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_day_statuses.manualCashoutAmount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "lottery_day_statuses" WHERE "netAmount" IS NOT NULL AND ("netAmount"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("netAmount"::numeric - round("netAmount"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for lottery_day_statuses.netAmount; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "payroll_entries" WHERE "hourlyRate" IS NOT NULL AND ("hourlyRate"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("hourlyRate"::numeric - round("hourlyRate"::numeric, 4)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for payroll_entries.hourlyRate; no money was converted';
  END IF;
  IF EXISTS (SELECT 1 FROM "payroll_entries" WHERE "grossPay" IS NOT NULL AND ("grossPay"::text IN ('NaN', 'Infinity', '-Infinity') OR abs("grossPay"::numeric - round("grossPay"::numeric, 2)) > 0.000001)) THEN
    RAISE EXCEPTION 'Precision review required for payroll_entries.grossPay; no money was converted';
  END IF;
END $$;
ALTER TABLE "users"
  ALTER COLUMN "hourlyRate" TYPE DECIMAL(14, 4) USING round("hourlyRate"::numeric, 4);
ALTER TABLE "locations"
  ALTER COLUMN "taxRate" TYPE DECIMAL(9, 4) USING round("taxRate"::numeric, 4),
  ALTER COLUMN "cardSurchargePercent" TYPE DECIMAL(9, 4) USING round("cardSurchargePercent"::numeric, 4);
ALTER TABLE "products"
  ALTER COLUMN "cost" TYPE DECIMAL(14, 4) USING round("cost"::numeric, 4),
  ALTER COLUMN "price" TYPE DECIMAL(14, 4) USING round("price"::numeric, 4),
  ALTER COLUMN "compareAtPrice" TYPE DECIMAL(14, 4) USING round("compareAtPrice"::numeric, 4);
ALTER TABLE "product_variants"
  ALTER COLUMN "price" TYPE DECIMAL(14, 4) USING round("price"::numeric, 4),
  ALTER COLUMN "cost" TYPE DECIMAL(14, 4) USING round("cost"::numeric, 4);
ALTER TABLE "suppliers"
  ALTER COLUMN "minimumOrder" TYPE DECIMAL(14, 4) USING round("minimumOrder"::numeric, 4);
ALTER TABLE "product_suppliers"
  ALTER COLUMN "cost" TYPE DECIMAL(14, 4) USING round("cost"::numeric, 4);
ALTER TABLE "purchase_orders"
  ALTER COLUMN "totalAmount" TYPE DECIMAL(14, 2) USING round("totalAmount"::numeric, 2);
ALTER TABLE "purchase_order_items"
  ALTER COLUMN "cost" TYPE DECIMAL(14, 4) USING round("cost"::numeric, 4),
  ALTER COLUMN "total" TYPE DECIMAL(14, 2) USING round("total"::numeric, 2);
ALTER TABLE "sales"
  ALTER COLUMN "subtotal" TYPE DECIMAL(14, 2) USING round("subtotal"::numeric, 2),
  ALTER COLUMN "tax" TYPE DECIMAL(14, 2) USING round("tax"::numeric, 2),
  ALTER COLUMN "discount" TYPE DECIMAL(14, 2) USING round("discount"::numeric, 2),
  ALTER COLUMN "surcharge" TYPE DECIMAL(14, 2) USING round("surcharge"::numeric, 2),
  ALTER COLUMN "total" TYPE DECIMAL(14, 2) USING round("total"::numeric, 2),
  ALTER COLUMN "amountPaid" TYPE DECIMAL(14, 2) USING round("amountPaid"::numeric, 2),
  ALTER COLUMN "changeDue" TYPE DECIMAL(14, 2) USING round("changeDue"::numeric, 2);
ALTER TABLE "sale_items"
  ALTER COLUMN "price" TYPE DECIMAL(14, 4) USING round("price"::numeric, 4),
  ALTER COLUMN "discount" TYPE DECIMAL(14, 2) USING round("discount"::numeric, 2),
  ALTER COLUMN "tax" TYPE DECIMAL(14, 2) USING round("tax"::numeric, 2),
  ALTER COLUMN "total" TYPE DECIMAL(14, 2) USING round("total"::numeric, 2),
  ALTER COLUMN "promotionDiscount" TYPE DECIMAL(14, 2) USING round("promotionDiscount"::numeric, 2);
ALTER TABLE "sale_payments"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2) USING round("amount"::numeric, 2);
ALTER TABLE "refunds"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2) USING round("amount"::numeric, 2);
ALTER TABLE "refund_items"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2) USING round("amount"::numeric, 2);
ALTER TABLE "customers"
  ALTER COLUMN "totalSpent" TYPE DECIMAL(14, 2) USING round("totalSpent"::numeric, 2);
ALTER TABLE "gift_cards"
  ALTER COLUMN "initialBalance" TYPE DECIMAL(14, 2) USING round("initialBalance"::numeric, 2),
  ALTER COLUMN "currentBalance" TYPE DECIMAL(14, 2) USING round("currentBalance"::numeric, 2);
ALTER TABLE "gift_card_transactions"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2) USING round("amount"::numeric, 2),
  ALTER COLUMN "balanceBefore" TYPE DECIMAL(14, 2) USING round("balanceBefore"::numeric, 2),
  ALTER COLUMN "balanceAfter" TYPE DECIMAL(14, 2) USING round("balanceAfter"::numeric, 2);
ALTER TABLE "store_credit_accounts"
  ALTER COLUMN "balance" TYPE DECIMAL(14, 2) USING round("balance"::numeric, 2);
ALTER TABLE "store_credit_transactions"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2) USING round("amount"::numeric, 2),
  ALTER COLUMN "balanceBefore" TYPE DECIMAL(14, 2) USING round("balanceBefore"::numeric, 2),
  ALTER COLUMN "balanceAfter" TYPE DECIMAL(14, 2) USING round("balanceAfter"::numeric, 2);
ALTER TABLE "house_accounts"
  ALTER COLUMN "creditLimit" TYPE DECIMAL(14, 2) USING round("creditLimit"::numeric, 2),
  ALTER COLUMN "balance" TYPE DECIMAL(14, 2) USING round("balance"::numeric, 2);
ALTER TABLE "house_account_transactions"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2) USING round("amount"::numeric, 2),
  ALTER COLUMN "balanceBefore" TYPE DECIMAL(14, 2) USING round("balanceBefore"::numeric, 2),
  ALTER COLUMN "balanceAfter" TYPE DECIMAL(14, 2) USING round("balanceAfter"::numeric, 2);
ALTER TABLE "exchanges"
  ALTER COLUMN "priceDifference" TYPE DECIMAL(14, 2) USING round("priceDifference"::numeric, 2);
ALTER TABLE "shifts"
  ALTER COLUMN "hourlyRate" TYPE DECIMAL(14, 4) USING round("hourlyRate"::numeric, 4),
  ALTER COLUMN "startingCash" TYPE DECIMAL(14, 2) USING round("startingCash"::numeric, 2),
  ALTER COLUMN "endingCash" TYPE DECIMAL(14, 2) USING round("endingCash"::numeric, 2),
  ALTER COLUMN "expectedCash" TYPE DECIMAL(14, 2) USING round("expectedCash"::numeric, 2),
  ALTER COLUMN "cashDifference" TYPE DECIMAL(14, 2) USING round("cashDifference"::numeric, 2),
  ALTER COLUMN "totalSales" TYPE DECIMAL(14, 2) USING round("totalSales"::numeric, 2);
ALTER TABLE "cash_movements"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2) USING round("amount"::numeric, 2);
ALTER TABLE "expenses"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2) USING round("amount"::numeric, 2);
ALTER TABLE "discounts"
  ALTER COLUMN "value" TYPE DECIMAL(14, 4) USING round("value"::numeric, 4),
  ALTER COLUMN "minPurchase" TYPE DECIMAL(14, 2) USING round("minPurchase"::numeric, 2),
  ALTER COLUMN "maxDiscount" TYPE DECIMAL(14, 2) USING round("maxDiscount"::numeric, 2);
ALTER TABLE "promotions"
  ALTER COLUMN "bundlePrice" TYPE DECIMAL(14, 4) USING round("bundlePrice"::numeric, 4),
  ALTER COLUMN "percentOff" TYPE DECIMAL(9, 4) USING round("percentOff"::numeric, 4),
  ALTER COLUMN "amountOff" TYPE DECIMAL(14, 4) USING round("amountOff"::numeric, 4);
ALTER TABLE "budgets"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2) USING round("amount"::numeric, 2),
  ALTER COLUMN "alertAt" TYPE DECIMAL(9, 4) USING round("alertAt"::numeric, 4);
ALTER TABLE "recurring_expenses"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2) USING round("amount"::numeric, 2);
ALTER TABLE "lottery_batches"
  ALTER COLUMN "pricePerTicket" TYPE DECIMAL(14, 4) USING round("pricePerTicket"::numeric, 4);
ALTER TABLE "lottery_transactions"
  ALTER COLUMN "onlineSalesAmount" TYPE DECIMAL(14, 2) USING round("onlineSalesAmount"::numeric, 2),
  ALTER COLUMN "offlineSalesAmount" TYPE DECIMAL(14, 2) USING round("offlineSalesAmount"::numeric, 2),
  ALTER COLUMN "cashoutAmount" TYPE DECIMAL(14, 2) USING round("cashoutAmount"::numeric, 2),
  ALTER COLUMN "netAmount" TYPE DECIMAL(14, 2) USING round("netAmount"::numeric, 2);
ALTER TABLE "lottery_ticket_scans"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2) USING round("amount"::numeric, 2);
ALTER TABLE "lottery_ticket_types"
  ALTER COLUMN "pricePerTicket" TYPE DECIMAL(14, 4) USING round("pricePerTicket"::numeric, 4);
ALTER TABLE "lottery_daily_entries"
  ALTER COLUMN "pricePerTicket" TYPE DECIMAL(14, 4) USING round("pricePerTicket"::numeric, 4),
  ALTER COLUMN "totalSales" TYPE DECIMAL(14, 2) USING round("totalSales"::numeric, 2);
ALTER TABLE "lottery_day_statuses"
  ALTER COLUMN "totalSales" TYPE DECIMAL(14, 2) USING round("totalSales"::numeric, 2),
  ALTER COLUMN "manualCashoutAmount" TYPE DECIMAL(14, 2) USING round("manualCashoutAmount"::numeric, 2),
  ALTER COLUMN "netAmount" TYPE DECIMAL(14, 2) USING round("netAmount"::numeric, 2);
ALTER TABLE "payroll_entries"
  ALTER COLUMN "hourlyRate" TYPE DECIMAL(14, 4) USING round("hourlyRate"::numeric, 4),
  ALTER COLUMN "grossPay" TYPE DECIMAL(14, 2) USING round("grossPay"::numeric, 2);
COMMIT;
