ALTER TABLE "accounting_exports" ADD COLUMN "locationId" TEXT;
CREATE INDEX "accounting_exports_locationId_createdAt_idx" ON "accounting_exports"("locationId", "createdAt");
-- Historic export scope cannot be inferred safely from an author's current
-- assignment. Unassigned rows remain platform-only for ownership review.
CREATE TABLE "receipt_attachments" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "receipt_attachments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "receipt_attachments_filename_key" ON "receipt_attachments"("filename");
CREATE INDEX "receipt_attachments_locationId_idx" ON "receipt_attachments"("locationId");
