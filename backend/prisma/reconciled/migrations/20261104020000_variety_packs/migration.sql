-- Variety packs: a pack product made of other products. Opening one moves its
-- units and value into the components; components are never stocked until opened.
-- CreateTable
CREATE TABLE "product_bundle_components" (
    "id" TEXT NOT NULL,
    "bundleProductId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "costShare" DECIMAL(7,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_bundle_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_openings" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "bundleProductId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "bundleEntryId" TEXT NOT NULL,
    "value" DECIMAL(24,8),
    "allocation" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bundle_openings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_bundle_components_componentProductId_idx" ON "product_bundle_components"("componentProductId");

-- CreateIndex
CREATE UNIQUE INDEX "product_bundle_components_bundleProductId_componentProductI_key" ON "product_bundle_components"("bundleProductId", "componentProductId");

-- CreateIndex
CREATE INDEX "bundle_openings_bundleProductId_createdAt_idx" ON "bundle_openings"("bundleProductId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_openings_locationId_idempotencyKey_key" ON "bundle_openings"("locationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "product_bundle_components" ADD CONSTRAINT "product_bundle_components_bundleProductId_fkey" FOREIGN KEY ("bundleProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_bundle_components" ADD CONSTRAINT "product_bundle_components_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_bundle_components"
  ADD CONSTRAINT product_bundle_component_quantity CHECK ("quantity" BETWEEN 1 AND 100000),
  ADD CONSTRAINT product_bundle_component_cost_share CHECK ("costShare" IS NULL OR ("costShare" > 0 AND "costShare" <= 1)),
  ADD CONSTRAINT product_bundle_component_not_self CHECK ("bundleProductId" <> "componentProductId");
ALTER TABLE "bundle_openings" ADD CONSTRAINT bundle_opening_quantity CHECK ("quantity" > 0);
