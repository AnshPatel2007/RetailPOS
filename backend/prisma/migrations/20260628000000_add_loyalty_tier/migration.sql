-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "loyaltyTier" TEXT NOT NULL DEFAULT 'BRONZE';

-- Drop search_vector if exists (schema removed it)
ALTER TABLE "products" DROP COLUMN IF EXISTS "search_vector";
