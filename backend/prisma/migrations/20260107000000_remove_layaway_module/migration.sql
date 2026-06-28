-- Remove Layaway Module
-- Migration to drop all layaway-related tables and enums
-- Created: 2026-01-07

-- Drop indexes first
DROP INDEX IF EXISTS "idx_layaways_customer_status";
DROP INDEX IF EXISTS "idx_layaways_location_status";
DROP INDEX IF EXISTS "idx_layaways_expires_at";
DROP INDEX IF EXISTS "idx_layaways_location";
DROP INDEX IF EXISTS "Layaway_locationId_idx";
DROP INDEX IF EXISTS "Layaway_status_locationId_idx";
DROP INDEX IF EXISTS "layaways_layawayNumber_key";
DROP INDEX IF EXISTS "layaways_customerId_idx";
DROP INDEX IF EXISTS "layaways_userId_idx";
DROP INDEX IF EXISTS "layaways_status_idx";
DROP INDEX IF EXISTS "layaway_items_layawayId_idx";
DROP INDEX IF EXISTS "layaway_payments_layawayId_idx";

-- Drop foreign key constraints
ALTER TABLE IF EXISTS "layaways" DROP CONSTRAINT IF EXISTS "layaways_customerId_fkey";
ALTER TABLE IF EXISTS "layaways" DROP CONSTRAINT IF EXISTS "layaways_userId_fkey";
ALTER TABLE IF EXISTS "layaways" DROP CONSTRAINT IF EXISTS "layaways_locationId_fkey";
ALTER TABLE IF EXISTS "layaway_items" DROP CONSTRAINT IF EXISTS "layaway_items_layawayId_fkey";
ALTER TABLE IF EXISTS "layaway_items" DROP CONSTRAINT IF EXISTS "layaway_items_productId_fkey";
ALTER TABLE IF EXISTS "layaway_payments" DROP CONSTRAINT IF EXISTS "layaway_payments_layawayId_fkey";

-- Drop tables (child tables first due to foreign keys)
DROP TABLE IF EXISTS "layaway_payments";
DROP TABLE IF EXISTS "layaway_items";
DROP TABLE IF EXISTS "layaways";

-- Drop enum
DROP TYPE IF EXISTS "LayawayStatus";

-- Success message
-- Layaway module successfully removed
