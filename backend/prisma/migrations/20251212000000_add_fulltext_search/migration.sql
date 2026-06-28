-- Add Full-Text Search to Products Table
-- This migration adds PostgreSQL full-text search capabilities to the products table

-- Add a generated tsvector column for full-text search
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(sku, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(barcode, '')), 'C')
) STORED;

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS "products_search_vector_idx" ON "products" USING GIN ("search_vector");

-- Add comment to document the index
COMMENT ON INDEX "products_search_vector_idx" IS 'Full-text search index for product name, description, SKU, and barcode. Weighted: name/SKU (A), description (B), barcode (C)';
