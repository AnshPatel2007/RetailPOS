BEGIN;
-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "loyaltyDiscount" DECIMAL(14,2),
ADD COLUMN     "pointsEarned" INTEGER,
ADD COLUMN     "pointsRedeemed" INTEGER,
ADD COLUMN     "pricingVersion" INTEGER;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "loyaltyDiscount" DECIMAL(14,2),
ADD COLUMN     "manualDiscount" DECIMAL(14,2),
ADD COLUMN     "pointsEarned" INTEGER,
ADD COLUMN     "pointsRedeemed" INTEGER,
ADD COLUMN     "surcharge" DECIMAL(14,2),
ADD COLUMN     "taxRate" DECIMAL(9,4),
ADD COLUMN     "taxTreatment" TEXT,
ADD COLUMN     "unitCost" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "pointsRestored" INTEGER,
ADD COLUMN     "pointsReversed" INTEGER,
ADD COLUMN     "taxAmount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "refund_items" ADD COLUMN     "costReturned" DECIMAL(14,4),
ADD COLUMN     "pointsRestored" INTEGER,
ADD COLUMN     "pointsReversed" INTEGER,
ADD COLUMN     "taxAmount" DECIMAL(14,2);


-- Preserve historical uncertainty: existing rows stay unversioned with NULL
-- snapshot fields. Never infer original cost or redeemed points from today's data.
CREATE FUNCTION protect_sale_snapshot() RETURNS trigger AS $$
BEGIN
  IF OLD."pricingVersion" IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Booked sales cannot be deleted'; END IF;
    IF (to_jsonb(NEW) - ARRAY['status','notes','receiptNumber','receiptEmail','updatedAt','refundedAt'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','notes','receiptNumber','receiptEmail','updatedAt','refundedAt']) THEN
      RAISE EXCEPTION 'Booked sale facts are immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sales_snapshot_immutable BEFORE UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION protect_sale_snapshot();
CREATE FUNCTION protect_sale_line_snapshot() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales WHERE id = OLD."saleId" AND "pricingVersion" IS NOT NULL) THEN
    RAISE EXCEPTION 'Booked sale lines are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sale_lines_snapshot_immutable BEFORE UPDATE OR DELETE ON sale_items FOR EACH ROW EXECUTE FUNCTION protect_sale_line_snapshot();
CREATE FUNCTION protect_refund_snapshot() RETURNS trigger AS $$
BEGIN
  IF OLD."pointsRestored" IS NOT NULL THEN RAISE EXCEPTION 'Allocated refund records are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER refunds_snapshot_immutable BEFORE UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION protect_refund_snapshot();
CREATE TRIGGER refund_lines_snapshot_immutable BEFORE UPDATE OR DELETE ON refund_items FOR EACH ROW EXECUTE FUNCTION protect_refund_snapshot();
COMMIT;
