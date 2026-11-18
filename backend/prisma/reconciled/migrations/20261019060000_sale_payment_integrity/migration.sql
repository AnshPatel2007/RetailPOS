BEGIN;
CREATE FUNCTION protect_sale_payment_snapshot() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales WHERE id = OLD."saleId" AND "pricingVersion" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM refunds WHERE "saleId" = OLD."saleId" AND tenders IS NOT NULL) THEN
    RAISE EXCEPTION 'Booked original payment records are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sale_payments_snapshot_immutable BEFORE UPDATE OR DELETE ON sale_payments FOR EACH ROW EXECUTE FUNCTION protect_sale_payment_snapshot();
COMMIT;
