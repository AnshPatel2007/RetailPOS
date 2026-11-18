-- Store Pulse: owners and managers are told when the store is not running the way it
-- usually does. Purely additive: one new table and new columns on a table added by
-- 20261116010000_store_alerts (apply that one first). Nothing existing changes, so an
-- API on the previous client keeps working before this is applied.

-- The store's pulse switches (all on) and "the store is closed today" (a store day,
-- YYYY-MM-DD). Owner-only switches; managers may mark the store closed.
ALTER TABLE "store_alert_settings"
  ADD COLUMN "pulseNotOpen" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pulseQuiet" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pulseRegister" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pulseLeftOpen" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "closedDay" TEXT,
  ADD COLUMN "closedById" TEXT;

-- When each computer set up as a register was last heard from (at most one write a
-- minute) and the session signed in on it. Deleted with the register; the person is
-- cleared when their account is deleted.
CREATE TABLE "register_heartbeats" (
  "registerDeviceId" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT,
  "sessionId" TEXT,
  CONSTRAINT "register_heartbeats_pkey" PRIMARY KEY ("registerDeviceId")
);
CREATE INDEX "register_heartbeats_userId_idx" ON "register_heartbeats"("userId");
ALTER TABLE "register_heartbeats" ADD CONSTRAINT "register_heartbeats_registerDeviceId_fkey" FOREIGN KEY ("registerDeviceId") REFERENCES "register_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "register_heartbeats" ADD CONSTRAINT "register_heartbeats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
