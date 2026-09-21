-- Legacy prescriptions remain without idempotency metadata; no backfill is performed.
ALTER TABLE "Prescription"
ADD COLUMN "uploadIdempotencyKey" VARCHAR(128),
ADD COLUMN "uploadRequestHash" VARCHAR(64);

CREATE UNIQUE INDEX "Prescription_orderId_uploadIdempotencyKey_key"
ON "Prescription"("orderId", "uploadIdempotencyKey");
