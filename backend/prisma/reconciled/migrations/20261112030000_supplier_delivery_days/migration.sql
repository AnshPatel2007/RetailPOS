-- The weekdays a supplier delivers (0 = Sunday ... 6 = Saturday), used to plan
-- reorders up to the delivery after next. Purely additive: an empty list for
-- every existing supplier, which keeps today's two-week planning for them.
ALTER TABLE "suppliers" ADD COLUMN "deliveryDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
