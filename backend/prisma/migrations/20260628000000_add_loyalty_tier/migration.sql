-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "loyaltyTier" TEXT NOT NULL DEFAULT 'BRONZE';

-- Add locationId to activity_logs
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "locationId" TEXT;

-- Drop search_vector if exists (schema removed it)
ALTER TABLE "products" DROP COLUMN IF EXISTS "search_vector";
