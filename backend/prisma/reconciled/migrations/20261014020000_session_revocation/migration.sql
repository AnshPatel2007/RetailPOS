-- Credentials and authority changes invalidate sessions atomically, including
-- updates through alternate user-management routes. Unrelated profile edits do
-- not log users out. Existing access JWTs without a session ID must refresh.
CREATE FUNCTION revoke_sessions_after_authority_change() RETURNS trigger AS $$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW."locationId" IS DISTINCT FROM OLD."locationId"
     OR NEW."isActive" IS DISTINCT FROM OLD."isActive" THEN
    UPDATE refresh_tokens SET "isRevoked" = true
      WHERE "userId" = NEW.id AND "isRevoked" = false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_revoke_sessions
AFTER UPDATE OF password, role, "locationId", "isActive" ON users
FOR EACH ROW EXECUTE FUNCTION revoke_sessions_after_authority_change();
