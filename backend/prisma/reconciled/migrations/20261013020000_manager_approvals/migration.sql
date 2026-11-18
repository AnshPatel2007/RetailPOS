-- CreateTable
CREATE TABLE "manager_approvals" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manager_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "manager_approvals_tokenHash_key" ON "manager_approvals"("tokenHash");

-- CreateIndex
CREATE INDEX "manager_approvals_cashierId_expiresAt_idx" ON "manager_approvals"("cashierId", "expiresAt");

