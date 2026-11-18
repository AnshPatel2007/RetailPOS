CREATE TABLE background_jobs (
  id TEXT PRIMARY KEY, "idempotencyKey" TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED', "locationId" TEXT, "requestedBy" TEXT,
  label TEXT NOT NULL, payload TEXT NOT NULL, result JSONB, attempts INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5, "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT, "leaseExpiresAt" TIMESTAMP(3), "lastError" TEXT, "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT background_jobs_attempts_check CHECK (attempts >= 0 AND "maxAttempts" BETWEEN 1 AND 10),
  CONSTRAINT background_jobs_status_check CHECK (status IN ('QUEUED','RUNNING','RETRY','ACCEPTED','COMPLETE','FAILED','REVIEW','CANCELLED'))
);
CREATE INDEX background_jobs_claim_idx ON background_jobs(status, "availableAt", "createdAt");
CREATE INDEX background_jobs_scope_idx ON background_jobs("locationId", kind, "createdAt");
CREATE TABLE background_job_attempts (
  id TEXT PRIMARY KEY, "jobId" TEXT NOT NULL REFERENCES background_jobs(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  number INTEGER NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL, "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  outcome TEXT NOT NULL, code TEXT, UNIQUE("jobId", number)
);
CREATE FUNCTION preserve_background_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Background job attempts are immutable'; END $$;
CREATE TRIGGER background_attempt_immutable BEFORE UPDATE OR DELETE ON background_job_attempts FOR EACH ROW EXECUTE FUNCTION preserve_background_attempt();
