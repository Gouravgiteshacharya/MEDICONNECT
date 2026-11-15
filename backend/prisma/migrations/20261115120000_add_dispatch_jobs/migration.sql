CREATE TYPE "DispatchJobStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE "DispatchJob" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "status" "DispatchJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastError" VARCHAR(2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "DispatchJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DispatchJob_orderId_fkey"
    FOREIGN KEY ("orderId")
    REFERENCES "Order"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DispatchJob_orderId_key"
  ON "DispatchJob"("orderId");

CREATE INDEX "DispatchJob_status_nextAttemptAt_idx"
  ON "DispatchJob"("status", "nextAttemptAt");

CREATE INDEX "DispatchJob_status_lockedAt_idx"
  ON "DispatchJob"("status", "lockedAt");
