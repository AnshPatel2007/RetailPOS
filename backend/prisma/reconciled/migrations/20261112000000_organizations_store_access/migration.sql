-- Multi-store owners, part 1: who owns which stores and who may work where.
-- An organization owns one or more stores. Every existing store gets its own
-- organization named after it, everyone with a store keeps access to it with their
-- current role, and every active ADMIN owns their store's organization, so nobody
-- gains or loses access. Additive: three new tables and two nullable columns; the only
-- existing column written is the new locations."organizationId".
-- Sign-in sessions start using refresh_tokens."activeLocationId" in a later release;
-- until then it stays NULL (= the person's home store).

CREATE TABLE "organizations" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_owners" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_owners_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organization_owners_organizationId_userId_key" ON "organization_owners"("organizationId", "userId");
CREATE INDEX "organization_owners_userId_idx" ON "organization_owners"("userId");

CREATE TABLE "user_store_access" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_store_access_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_store_access_userId_locationId_key" ON "user_store_access"("userId", "locationId");
CREATE INDEX "user_store_access_locationId_idx" ON "user_store_access"("locationId");

ALTER TABLE "locations" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "locations_organizationId_idx" ON "locations"("organizationId");
ALTER TABLE "refresh_tokens" ADD COLUMN "activeLocationId" TEXT;

ALTER TABLE "locations" ADD CONSTRAINT "locations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_owners" ADD CONSTRAINT "organization_owners_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_owners" ADD CONSTRAINT "organization_owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_store_access" ADD CONSTRAINT "user_store_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_store_access" ADD CONSTRAINT "user_store_access_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one organization per store, named after it.
DO $$
DECLARE
  store RECORD;
  org TEXT;
BEGIN
  FOR store IN SELECT id, name FROM locations WHERE "organizationId" IS NULL ORDER BY "createdAt", id LOOP
    org := gen_random_uuid()::text;
    INSERT INTO organizations (id, name, "createdAt", "updatedAt") VALUES (org, store.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    UPDATE locations SET "organizationId" = org WHERE id = store.id;
  END LOOP;
END $$;

-- Backfill: everyone with a store may work there in their current role.
-- Platform admins have no store of their own and get no row.
INSERT INTO user_store_access (id, "userId", "locationId", role, "createdAt")
SELECT gen_random_uuid()::text, u.id, u."locationId", u.role, CURRENT_TIMESTAMP
FROM users u
WHERE u."locationId" IS NOT NULL AND u.role <> 'SUPER_ADMIN';

-- Backfill: every active ADMIN owns their store's organization.
INSERT INTO organization_owners (id, "organizationId", "userId", "createdAt")
SELECT gen_random_uuid()::text, l."organizationId", u.id, CURRENT_TIMESTAMP
FROM users u JOIN locations l ON l.id = u."locationId"
WHERE u.role = 'ADMIN' AND u."isActive";

-- Every store belongs to an organization. A store created (or moved out of one)
-- without an organization gets its own, named after the store, so every seed,
-- test and older code path that creates a store keeps working unchanged.
CREATE FUNCTION assign_default_organization() RETURNS trigger AS $$
BEGIN
  IF NEW."organizationId" IS NULL THEN
    NEW."organizationId" := gen_random_uuid()::text;
    INSERT INTO organizations (id, name, "createdAt", "updatedAt")
      VALUES (NEW."organizationId", NEW.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER locations_default_organization
BEFORE INSERT OR UPDATE OF "organizationId" ON locations
FOR EACH ROW EXECUTE FUNCTION assign_default_organization();

-- The home store's access row follows users."locationId" and users.role, whichever
-- code path changes them. When the home store changes, the old home row goes, unless
-- the person owns that store's organization: owners keep ADMIN access to all of its
-- stores. A platform admin keeps no home row.
CREATE FUNCTION sync_home_store_access() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."locationId" IS NOT NULL
     AND (NEW."locationId" IS DISTINCT FROM OLD."locationId" OR NEW.role = 'SUPER_ADMIN') THEN
    IF NEW.role <> 'SUPER_ADMIN' AND EXISTS (
      SELECT 1 FROM organization_owners o
      JOIN locations l ON l."organizationId" = o."organizationId"
      WHERE o."userId" = NEW.id AND l.id = OLD."locationId"
    ) THEN
      UPDATE user_store_access SET role = 'ADMIN'
        WHERE "userId" = NEW.id AND "locationId" = OLD."locationId" AND role <> 'ADMIN';
    ELSE
      DELETE FROM user_store_access WHERE "userId" = NEW.id AND "locationId" = OLD."locationId";
    END IF;
  END IF;
  IF NEW."locationId" IS NOT NULL AND NEW.role <> 'SUPER_ADMIN' THEN
    INSERT INTO user_store_access (id, "userId", "locationId", role, "createdAt")
      VALUES (gen_random_uuid()::text, NEW.id, NEW."locationId", NEW.role, CURRENT_TIMESTAMP)
      ON CONFLICT ("userId", "locationId") DO UPDATE SET role = EXCLUDED.role
      WHERE user_store_access.role IS DISTINCT FROM EXCLUDED.role;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_sync_home_access
AFTER INSERT OR UPDATE OF "locationId", role ON users
FOR EACH ROW EXECUTE FUNCTION sync_home_store_access();
