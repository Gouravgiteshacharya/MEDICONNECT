-- Existing orders remain uncommitted. No historical inventory is backfilled.
ALTER TABLE "Order"
ADD COLUMN "inventoryCommittedAt" TIMESTAMP(3),
ADD COLUMN "inventoryRestoredAt" TIMESTAMP(3);
