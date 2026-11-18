-- Customers belong to one store, but email and phone were unique across every
-- store: a second store could not add a customer who already shopped at the
-- first, and the refusal revealed that they did. Uniqueness now applies within
-- a store. Existing rows already satisfy the new, looser rule (they were unique
-- everywhere), so no data changes and nothing can fail on existing records.
DROP INDEX "customers_email_key";
DROP INDEX "customers_phone_key";
CREATE UNIQUE INDEX "customers_email_locationId_key" ON "customers"("email", "locationId");
CREATE UNIQUE INDEX "customers_phone_locationId_key" ON "customers"("phone", "locationId");
