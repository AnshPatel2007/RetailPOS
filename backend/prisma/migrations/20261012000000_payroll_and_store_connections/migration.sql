-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "payrollFrequency" TEXT NOT NULL DEFAULT 'WEEKLY';

-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "hourlyRate" DOUBLE PRECISION,
ADD COLUMN     "payrollFrequency" TEXT,
ADD COLUMN     "payrollTimezone" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "hourlyRate" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "store_connections" (
    "id" TEXT NOT NULL,
    "locationAId" TEXT NOT NULL,
    "locationBId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_entries" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "seconds" INTEGER NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "grossPay" DOUBLE PRECISION NOT NULL,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_connections_locationAId_locationBId_key" ON "store_connections"("locationAId", "locationBId");

-- CreateIndex
CREATE INDEX "payroll_entries_locationId_periodEnd_idx" ON "payroll_entries"("locationId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_entries_shiftId_periodStart_key" ON "payroll_entries"("shiftId", "periodStart");

-- AddForeignKey
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_locationAId_fkey" FOREIGN KEY ("locationAId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_locationBId_fkey" FOREIGN KEY ("locationBId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

