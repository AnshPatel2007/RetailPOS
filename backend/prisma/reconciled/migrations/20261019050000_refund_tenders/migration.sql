BEGIN;
ALTER TABLE "refunds" ADD COLUMN "tenders" JSONB;
ALTER TABLE "refunds" ADD CONSTRAINT refunds_tenders_array CHECK ("tenders" IS NULL OR jsonb_typeof("tenders") = 'array');
-- Historic refunds remain unknown. Inventing source allocations would conceal
-- earlier cash-outs or duplicate credits. New allocated refunds cannot mutate.
CREATE FUNCTION protect_refund_tenders() RETURNS trigger AS $$
BEGIN
  IF OLD."tenders" IS NOT NULL THEN RAISE EXCEPTION 'Refund tender allocations are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER refund_tenders_immutable BEFORE UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION protect_refund_tenders();
COMMIT;
