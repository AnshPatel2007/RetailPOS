-- Register PIN sign-in. Purely additive: nullable/defaulted columns and one new table.
-- PINs are bcrypt hashes. Failed PIN attempts lock PIN sign-in on their own, so a
-- mistyped PIN never locks the person's password sign-in. Changing a PIN does not
-- touch password/role/store/active, so users_revoke_sessions is not triggered.
ALTER TABLE "users"
  ADD COLUMN "pinHash" TEXT,
  ADD COLUMN "pinSetAt" TIMESTAMP(3),
  ADD COLUMN "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pinLockoutUntil" TIMESTAMP(3);

-- A computer a manager has set up as a register. Only a SHA-256 hash of its secret
-- is stored; removing the register (revokedAt) ends PIN sign-in on it.
CREATE TABLE "register_devices" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "register_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "register_devices_tokenHash_key" ON "register_devices"("tokenHash");
CREATE INDEX "register_devices_locationId_idx" ON "register_devices"("locationId");
ALTER TABLE "register_devices" ADD CONSTRAINT "register_devices_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "register_devices" ADD CONSTRAINT "register_devices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
