ALTER TABLE users ADD COLUMN "twoFactorSetupSecret" TEXT,
  ADD COLUMN "twoFactorSetupExpires" TIMESTAMP(3),
  ADD COLUMN "twoFactorLastStep" INTEGER,
  ADD COLUMN "twoFactorVersion" INTEGER NOT NULL DEFAULT 0;
-- Unfinished legacy enrollment has no reliable creation/expiry instant.
UPDATE users SET "twoFactorSecret" = NULL WHERE "twoFactorEnabled" = false;

CREATE OR REPLACE FUNCTION revoke_sessions_after_authority_change() RETURNS trigger AS $$
DECLARE keep_session TEXT := NULLIF(current_setting('pos.keep_session_id', true), '');
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW."locationId" IS DISTINCT FROM OLD."locationId" OR NEW."isActive" IS DISTINCT FROM OLD."isActive" THEN
    UPDATE refresh_tokens SET "isRevoked" = true WHERE "userId" = NEW.id AND "isRevoked" = false;
  ELSIF NEW."twoFactorEnabled" IS DISTINCT FROM OLD."twoFactorEnabled"
     OR NEW."twoFactorSecret" IS DISTINCT FROM OLD."twoFactorSecret"
     OR NEW."twoFactorVersion" IS DISTINCT FROM OLD."twoFactorVersion" THEN
    UPDATE refresh_tokens SET "isRevoked" = true
      WHERE "userId" = NEW.id AND "isRevoked" = false
        AND (keep_session IS NULL OR id <> keep_session);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER users_revoke_sessions ON users;
CREATE TRIGGER users_revoke_sessions AFTER UPDATE OF password, role, "locationId", "isActive",
  "twoFactorEnabled", "twoFactorSecret", "twoFactorVersion" ON users
  FOR EACH ROW EXECUTE FUNCTION revoke_sessions_after_authority_change();
