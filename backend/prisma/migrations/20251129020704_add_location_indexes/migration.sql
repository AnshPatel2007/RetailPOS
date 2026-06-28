-- Add indexes on locationId columns for better query performance

-- Core entities
CREATE INDEX IF NOT EXISTS "idx_products_location" ON "products"("locationId");
CREATE INDEX IF NOT EXISTS "idx_customers_location" ON "customers"("locationId");
CREATE INDEX IF NOT EXISTS "idx_sales_location" ON "sales"("locationId");
CREATE INDEX IF NOT EXISTS "idx_expenses_location" ON "expenses"("locationId");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_location" ON "purchase_orders"("locationId");

-- Supporting entities
CREATE INDEX IF NOT EXISTS "idx_suppliers_location" ON "suppliers"("locationId");
CREATE INDEX IF NOT EXISTS "idx_categories_location" ON "categories"("locationId");
CREATE INDEX IF NOT EXISTS "idx_tax_rates_location" ON "tax_rates"("locationId");
CREATE INDEX IF NOT EXISTS "idx_discounts_location" ON "discounts"("locationId");
CREATE INDEX IF NOT EXISTS "idx_inventory_logs_location" ON "inventory_logs"("locationId");

-- Financial entities
CREATE INDEX IF NOT EXISTS "idx_budgets_location" ON "budgets"("locationId");
CREATE INDEX IF NOT EXISTS "idx_recurring_expenses_location" ON "recurring_expenses"("locationId");

-- Additional entities
CREATE INDEX IF NOT EXISTS "idx_layaways_location" ON "layaways"("locationId");
CREATE INDEX IF NOT EXISTS "idx_users_location" ON "users"("locationId");

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS "idx_sales_location_created" ON "sales"("locationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_expenses_location_date" ON "expenses"("locationId", "expenseDate" DESC);
CREATE INDEX IF NOT EXISTS "idx_products_location_active" ON "products"("locationId", "isActive");
CREATE INDEX IF NOT EXISTS "idx_customers_location_active" ON "customers"("locationId", "isActive");
