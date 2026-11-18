-- A variety pack's cost splits by count only: pack cost / units in the pack,
-- times each product's quantity. Per-product cost shares are removed.
ALTER TABLE "product_bundle_components" DROP CONSTRAINT IF EXISTS product_bundle_component_cost_share;
ALTER TABLE "product_bundle_components" DROP COLUMN "costShare";
