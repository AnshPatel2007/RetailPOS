-- Add quickCode to Product
ALTER TABLE "products" ADD COLUMN "quickCode" TEXT;

-- Add unique constraint for quickCode with locationId
CREATE UNIQUE INDEX "products_quickCode_locationId_key" ON "products"("quickCode", "locationId");

-- Add index for quickCode
CREATE INDEX "products_quickCode_idx" ON "products"("quickCode");

-- Enhance Discount model
ALTER TABLE "discounts" ADD COLUMN "applyToProducts" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "discounts" ADD COLUMN "buyQuantity" INTEGER;
ALTER TABLE "discounts" ADD COLUMN "getQuantity" INTEGER;
ALTER TABLE "discounts" ADD COLUMN "getDiscount" DOUBLE PRECISION;
ALTER TABLE "discounts" ADD COLUMN "stackable" BOOLEAN NOT NULL DEFAULT false;

-- Add comment to type field
COMMENT ON COLUMN "discounts"."type" IS 'PERCENTAGE, FIXED_AMOUNT, BUY_X_GET_Y';

-- CreateTable DiscountProduct
CREATE TABLE "discount_products" (
    "id" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discount_products_discountId_idx" ON "discount_products"("discountId");

-- CreateIndex
CREATE INDEX "discount_products_productId_idx" ON "discount_products"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "discount_products_discountId_productId_key" ON "discount_products"("discountId", "productId");

-- AddForeignKey
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable ProductFavorite
CREATE TABLE "product_favorites" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT,
    "locationId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_favorites_userId_idx" ON "product_favorites"("userId");

-- CreateIndex
CREATE INDEX "product_favorites_locationId_idx" ON "product_favorites"("locationId");

-- CreateIndex
CREATE INDEX "product_favorites_sortOrder_idx" ON "product_favorites"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "product_favorites_productId_userId_locationId_key" ON "product_favorites"("productId", "userId", "locationId");

-- AddForeignKey
ALTER TABLE "product_favorites" ADD CONSTRAINT "product_favorites_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable CartTemplate
CREATE TABLE "cart_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "locationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cart_templates_userId_idx" ON "cart_templates"("userId");

-- CreateIndex
CREATE INDEX "cart_templates_locationId_idx" ON "cart_templates"("locationId");

-- CreateTable CartTemplateItem
CREATE TABLE "cart_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "customPrice" DOUBLE PRECISION,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cart_template_items_templateId_idx" ON "cart_template_items"("templateId");

-- CreateIndex
CREATE INDEX "cart_template_items_productId_idx" ON "cart_template_items"("productId");

-- AddForeignKey
ALTER TABLE "cart_template_items" ADD CONSTRAINT "cart_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "cart_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_template_items" ADD CONSTRAINT "cart_template_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable LastSale
CREATE TABLE "last_sales" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT,
    "saleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "last_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "last_sales_userId_key" ON "last_sales"("userId");

-- CreateIndex
CREATE INDEX "last_sales_userId_idx" ON "last_sales"("userId");

-- CreateIndex
CREATE INDEX "last_sales_locationId_idx" ON "last_sales"("locationId");
