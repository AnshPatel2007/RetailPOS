-- Performance Indexes Migration
-- These indexes significantly improve query performance for reporting and analytics

-- Sales indexes for report generation and analytics
CREATE INDEX IF NOT EXISTS "idx_sales_completed_at" ON "sales"("completedAt") WHERE "status" = 'COMPLETED';
CREATE INDEX IF NOT EXISTS "idx_sales_location_status" ON "sales"("locationId", "status");
CREATE INDEX IF NOT EXISTS "idx_sales_user_created" ON "sales"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_sales_customer_created" ON "sales"("customerId", "createdAt");

-- Product indexes for inventory and catalog queries
CREATE INDEX IF NOT EXISTS "idx_products_location_category" ON "products"("locationId", "isActive", "categoryId");
CREATE INDEX IF NOT EXISTS "idx_products_sku" ON "products"("sku");
CREATE INDEX IF NOT EXISTS "idx_products_barcode" ON "products"("barcode");
CREATE INDEX IF NOT EXISTS "idx_products_stock_alert" ON "products"("lowStockAlert", "stockQuantity") WHERE "trackInventory" = true;

-- Sale items indexes for product sales analytics
CREATE INDEX IF NOT EXISTS "idx_sale_items_product" ON "sale_items"("productId", "saleId");
CREATE INDEX IF NOT EXISTS "idx_sale_items_sale" ON "sale_items"("saleId");

-- Customer indexes for customer management and history
CREATE INDEX IF NOT EXISTS "idx_customers_location_active" ON "customers"("locationId", "isActive");
CREATE INDEX IF NOT EXISTS "idx_customers_phone" ON "customers"("phone");
CREATE INDEX IF NOT EXISTS "idx_customers_email" ON "customers"("email");
CREATE INDEX IF NOT EXISTS "idx_customers_created" ON "customers"("createdAt");

-- Expense indexes for financial reporting
CREATE INDEX IF NOT EXISTS "idx_expenses_location_date" ON "expenses"("locationId", "expenseDate");
CREATE INDEX IF NOT EXISTS "idx_expenses_category_date" ON "expenses"("category", "expenseDate");
CREATE INDEX IF NOT EXISTS "idx_expenses_status" ON "expenses"("status");

-- Shift indexes for shift management and reporting
CREATE INDEX IF NOT EXISTS "idx_shifts_user_date" ON "shifts"("userId", "clockInAt");
CREATE INDEX IF NOT EXISTS "idx_shifts_location_closed" ON "shifts"("locationId", "isClosed");
CREATE INDEX IF NOT EXISTS "idx_shifts_clock_out" ON "shifts"("clockOutAt");

-- Purchase order indexes for inventory management
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_supplier_status" ON "purchase_orders"("supplierId", "status");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_location_date" ON "purchase_orders"("locationId", "orderedAt");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_expected_delivery" ON "purchase_orders"("expectedAt") WHERE "status" IN ('PENDING', 'APPROVED');

-- Layaway indexes for layaway management
CREATE INDEX IF NOT EXISTS "idx_layaways_customer_status" ON "layaways"("customerId", "status");
CREATE INDEX IF NOT EXISTS "idx_layaways_location_status" ON "layaways"("locationId", "status");
CREATE INDEX IF NOT EXISTS "idx_layaways_expires_at" ON "layaways"("expiresAt") WHERE "status" = 'ACTIVE';

-- Category indexes for filtering
CREATE INDEX IF NOT EXISTS "idx_categories_location_active" ON "categories"("locationId", "isActive");
CREATE INDEX IF NOT EXISTS "idx_categories_parent" ON "categories"("parentId");

-- Supplier indexes
CREATE INDEX IF NOT EXISTS "idx_suppliers_location_active" ON "suppliers"("locationId", "isActive");
CREATE INDEX IF NOT EXISTS "idx_suppliers_email" ON "suppliers"("email");

-- Tax indexes for checkout calculations
CREATE INDEX IF NOT EXISTS "idx_tax_rates_location_active" ON "tax_rates"("locationId", "isActive");

-- Discount indexes for discount application
CREATE INDEX IF NOT EXISTS "idx_discounts_code" ON "discounts"("code");
CREATE INDEX IF NOT EXISTS "idx_discounts_location_active" ON "discounts"("locationId", "isActive");
CREATE INDEX IF NOT EXISTS "idx_discounts_dates" ON "discounts"("startDate", "endDate");

-- User indexes for authentication and authorization
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users"("email");
CREATE INDEX IF NOT EXISTS "idx_users_location_role" ON "users"("locationId", "role");
CREATE INDEX IF NOT EXISTS "idx_users_is_active" ON "users"("isActive");

-- Location indexes
CREATE INDEX IF NOT EXISTS "idx_locations_is_active" ON "locations"("isActive");

-- Audit log indexes (if audit logs are added in future)
-- CREATE INDEX IF NOT EXISTS "idx_audit_logs_entity" ON "audit_logs"("entityType", "entityId");
-- CREATE INDEX IF NOT EXISTS "idx_audit_logs_user_created" ON "audit_logs"("userId", "createdAt");
