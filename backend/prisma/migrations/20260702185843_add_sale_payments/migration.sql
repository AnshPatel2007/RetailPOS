/*
  Warnings:

  - You are about to drop the column `locationId` on the `accounting_exports` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `categories` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `customers` table. All the data in the column will be lost.
  - You are about to drop the column `applyToProducts` on the `discounts` table. All the data in the column will be lost.
  - You are about to drop the column `buyQuantity` on the `discounts` table. All the data in the column will be lost.
  - You are about to drop the column `getDiscount` on the `discounts` table. All the data in the column will be lost.
  - You are about to drop the column `getQuantity` on the `discounts` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `discounts` table. All the data in the column will be lost.
  - You are about to drop the column `stackable` on the `discounts` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `inventory_logs` table. All the data in the column will be lost.
  - You are about to drop the column `quickCode` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `purchase_orders` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `sale_payments` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `suppliers` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `tax_rates` table. All the data in the column will be lost.
  - You are about to drop the `cart_template_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `cart_templates` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `discount_products` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `last_sales` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `product_favorites` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `paymentMethod` on table `sales` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "accounting_exports" DROP CONSTRAINT "accounting_exports_locationId_fkey";

-- DropForeignKey
ALTER TABLE "cart_template_items" DROP CONSTRAINT "cart_template_items_productId_fkey";

-- DropForeignKey
ALTER TABLE "cart_template_items" DROP CONSTRAINT "cart_template_items_templateId_fkey";

-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_locationId_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_locationId_fkey";

-- DropForeignKey
ALTER TABLE "discount_products" DROP CONSTRAINT "discount_products_discountId_fkey";

-- DropForeignKey
ALTER TABLE "discount_products" DROP CONSTRAINT "discount_products_productId_fkey";

-- DropForeignKey
ALTER TABLE "discounts" DROP CONSTRAINT "discounts_locationId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_logs" DROP CONSTRAINT "inventory_logs_locationId_fkey";

-- DropForeignKey
ALTER TABLE "product_favorites" DROP CONSTRAINT "product_favorites_productId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_locationId_fkey";

-- DropForeignKey
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_locationId_fkey";

-- DropForeignKey
ALTER TABLE "tax_rates" DROP CONSTRAINT "tax_rates_locationId_fkey";

-- DropIndex
DROP INDEX "accounting_exports_locationId_idx";

-- DropIndex
DROP INDEX "ActivityLog_userId_createdAt_idx";

-- DropIndex
DROP INDEX "Budget_isActive_locationId_idx";

-- DropIndex
DROP INDEX "Budget_period_startDate_locationId_idx";

-- DropIndex
DROP INDEX "categories_locationId_idx";

-- DropIndex
DROP INDEX "idx_categories_location";

-- DropIndex
DROP INDEX "idx_categories_location_active";

-- DropIndex
DROP INDEX "idx_categories_parent";

-- DropIndex
DROP INDEX "customers_locationId_idx";

-- DropIndex
DROP INDEX "idx_customers_created";

-- DropIndex
DROP INDEX "idx_customers_location";

-- DropIndex
DROP INDEX "idx_customers_location_active";

-- DropIndex
DROP INDEX "discounts_locationId_idx";

-- DropIndex
DROP INDEX "idx_discounts_code";

-- DropIndex
DROP INDEX "idx_discounts_dates";

-- DropIndex
DROP INDEX "idx_discounts_location";

-- DropIndex
DROP INDEX "idx_discounts_location_active";

-- DropIndex
DROP INDEX "Expense_category_expenseDate_status_idx";

-- DropIndex
DROP INDEX "Expense_expenseDate_status_locationId_idx";

-- DropIndex
DROP INDEX "idx_expenses_category_date";

-- DropIndex
DROP INDEX "idx_expenses_location_date";

-- DropIndex
DROP INDEX "idx_inventory_logs_location";

-- DropIndex
DROP INDEX "inventory_logs_locationId_idx";

-- DropIndex
DROP INDEX "idx_locations_is_active";

-- DropIndex
DROP INDEX "Product_trackInventory_stockQuantity_locationId_idx";

-- DropIndex
DROP INDEX "idx_products_location_active";

-- DropIndex
DROP INDEX "idx_products_location_category";

-- DropIndex
DROP INDEX "products_quickCode_idx";

-- DropIndex
DROP INDEX "products_quickCode_locationId_key";

-- DropIndex
DROP INDEX "idx_purchase_orders_location";

-- DropIndex
DROP INDEX "idx_purchase_orders_location_date";

-- DropIndex
DROP INDEX "idx_purchase_orders_supplier_status";

-- DropIndex
DROP INDEX "purchase_orders_locationId_idx";

-- DropIndex
DROP INDEX "RecurringExpense_nextDueDate_isActive_idx";

-- DropIndex
DROP INDEX "Refund_createdAt_idx";

-- DropIndex
DROP INDEX "idx_sale_items_product";

-- DropIndex
DROP INDEX "idx_sales_customer_created";

-- DropIndex
DROP INDEX "idx_sales_location_created";

-- DropIndex
DROP INDEX "idx_sales_location_status";

-- DropIndex
DROP INDEX "idx_sales_user_created";

-- DropIndex
DROP INDEX "Shift_userId_isClosed_clockInAt_idx";

-- DropIndex
DROP INDEX "idx_shifts_clock_out";

-- DropIndex
DROP INDEX "idx_shifts_location_closed";

-- DropIndex
DROP INDEX "idx_shifts_user_date";

-- DropIndex
DROP INDEX "idx_suppliers_email";

-- DropIndex
DROP INDEX "idx_suppliers_location";

-- DropIndex
DROP INDEX "idx_suppliers_location_active";

-- DropIndex
DROP INDEX "suppliers_locationId_idx";

-- DropIndex
DROP INDEX "idx_tax_rates_location";

-- DropIndex
DROP INDEX "idx_tax_rates_location_active";

-- DropIndex
DROP INDEX "tax_rates_locationId_idx";

-- DropIndex
DROP INDEX "idx_users_is_active";

-- DropIndex
DROP INDEX "idx_users_location_role";

-- AlterTable
ALTER TABLE "accounting_exports" DROP COLUMN "locationId";

-- AlterTable
ALTER TABLE "categories" DROP COLUMN "locationId";

-- AlterTable
ALTER TABLE "customers" DROP COLUMN "locationId";

-- AlterTable
ALTER TABLE "discounts" DROP COLUMN "applyToProducts",
DROP COLUMN "buyQuantity",
DROP COLUMN "getDiscount",
DROP COLUMN "getQuantity",
DROP COLUMN "locationId",
DROP COLUMN "stackable";

-- AlterTable
ALTER TABLE "inventory_logs" DROP COLUMN "locationId";

-- AlterTable
ALTER TABLE "products" DROP COLUMN "quickCode";

-- AlterTable
ALTER TABLE "purchase_orders" DROP COLUMN "locationId";

-- AlterTable
ALTER TABLE "sale_payments" DROP COLUMN "notes";

-- AlterTable
ALTER TABLE "sales" ALTER COLUMN "paymentMethod" SET NOT NULL;

-- AlterTable
ALTER TABLE "suppliers" DROP COLUMN "locationId";

-- AlterTable
ALTER TABLE "tax_rates" DROP COLUMN "locationId";

-- DropTable
DROP TABLE "cart_template_items";

-- DropTable
DROP TABLE "cart_templates";

-- DropTable
DROP TABLE "discount_products";

-- DropTable
DROP TABLE "last_sales";

-- DropTable
DROP TABLE "product_favorites";

-- CreateTable
CREATE TABLE "lottery_ticket_types" (
    "id" TEXT NOT NULL,
    "ticketName" TEXT NOT NULL,
    "ticketCode" TEXT NOT NULL,
    "pricePerTicket" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lottery_ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_daily_entries" (
    "id" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "startNumber" INTEGER NOT NULL,
    "endNumber" INTEGER NOT NULL,
    "pricePerTicket" DOUBLE PRECISION NOT NULL,
    "ticketsSold" INTEGER NOT NULL DEFAULT 0,
    "totalSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lottery_daily_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_day_statuses" (
    "id" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "totalTicketsSold" INTEGER NOT NULL DEFAULT 0,
    "totalSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "manualCashoutAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lottery_day_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lottery_ticket_types_locationId_idx" ON "lottery_ticket_types"("locationId");

-- CreateIndex
CREATE INDEX "lottery_ticket_types_ticketCode_idx" ON "lottery_ticket_types"("ticketCode");

-- CreateIndex
CREATE INDEX "lottery_daily_entries_entryDate_idx" ON "lottery_daily_entries"("entryDate");

-- CreateIndex
CREATE INDEX "lottery_daily_entries_ticketTypeId_idx" ON "lottery_daily_entries"("ticketTypeId");

-- CreateIndex
CREATE INDEX "lottery_daily_entries_locationId_idx" ON "lottery_daily_entries"("locationId");

-- CreateIndex
CREATE INDEX "lottery_day_statuses_entryDate_idx" ON "lottery_day_statuses"("entryDate");

-- CreateIndex
CREATE INDEX "lottery_day_statuses_locationId_idx" ON "lottery_day_statuses"("locationId");

-- CreateIndex
CREATE INDEX "lottery_ticket_scans_scannedAt_idx" ON "lottery_ticket_scans"("scannedAt");

-- AddForeignKey
ALTER TABLE "lottery_ticket_types" ADD CONSTRAINT "lottery_ticket_types_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_daily_entries" ADD CONSTRAINT "lottery_daily_entries_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "lottery_ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_daily_entries" ADD CONSTRAINT "lottery_daily_entries_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_daily_entries" ADD CONSTRAINT "lottery_daily_entries_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_daily_entries" ADD CONSTRAINT "lottery_daily_entries_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_day_statuses" ADD CONSTRAINT "lottery_day_statuses_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_day_statuses" ADD CONSTRAINT "lottery_day_statuses_closedBy_fkey" FOREIGN KEY ("closedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_day_statuses" ADD CONSTRAINT "lottery_day_statuses_reopenedBy_fkey" FOREIGN KEY ("reopenedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
