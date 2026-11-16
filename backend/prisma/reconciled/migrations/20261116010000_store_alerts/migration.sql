-- Phone alerts: owners (and, for how the store is running, managers) are told at
-- once on their phones. Purely additive: three new tables, nothing existing changes.

-- A phone or computer where someone turned alerts on. The keys are the browser's
-- own push keys; a push service that answers "gone" removes the row. Deleted with
-- the person.
CREATE TABLE "push_subscriptions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "deviceLabel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSentAt" TIMESTAMP(3),
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each alert once per store and key (a retry or a second server never sends it
-- twice); resolvedAt closes it when its condition clears.
CREATE TABLE "store_alerts" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "audience" TEXT NOT NULL DEFAULT 'OWNERS',
  "sentence" TEXT NOT NULL,
  "href" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "store_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_alerts_locationId_key_key" ON "store_alerts"("locationId", "key");
CREATE INDEX "store_alerts_locationId_resolvedAt_idx" ON "store_alerts"("locationId", "resolvedAt");
ALTER TABLE "store_alerts" ADD CONSTRAINT "store_alerts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The owner's alert amounts (a store without a row uses $50 and $5). Owner-only,
-- kept out of the store settings every register receives.
CREATE TABLE "store_alert_settings" (
  "locationId" TEXT NOT NULL,
  "refundAlertOver" DECIMAL(14,2) DEFAULT 50,
  "drawerAlertOver" DECIMAL(14,2) DEFAULT 5,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "store_alert_settings_pkey" PRIMARY KEY ("locationId")
);
ALTER TABLE "store_alert_settings" ADD CONSTRAINT "store_alert_settings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
