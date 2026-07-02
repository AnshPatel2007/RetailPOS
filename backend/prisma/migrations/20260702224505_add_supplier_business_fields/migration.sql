-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "minimumOrder" DOUBLE PRECISION,
ADD COLUMN     "paymentTerms" TEXT;
