CREATE FUNCTION preserve_background_job_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Stored jobs retain their evidence'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW."locationId" IS DISTINCT FROM OLD."locationId"
     OR NEW."requestedBy" IS DISTINCT FROM OLD."requestedBy" OR NEW.label IS DISTINCT FROM OLD.label
     OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."maxAttempts" IS DISTINCT FROM OLD."maxAttempts" OR NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'Job identity, content and attempt budget are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER background_job_content_immutable BEFORE UPDATE OR DELETE ON background_jobs
FOR EACH ROW EXECUTE FUNCTION preserve_background_job_content();
