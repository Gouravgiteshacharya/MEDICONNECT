-- AlterTable
ALTER TABLE "DeliveryAssignment" ADD COLUMN     "offerExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DispatchAttempt" ADD COLUMN     "deterministicRank" INTEGER,
ADD COLUMN     "dispatchPolicyVersion" TEXT,
ADD COLUMN     "dispatchRoundId" UUID,
ADD COLUMN     "freshnessThresholdMs" DOUBLE PRECISION,
ADD COLUMN     "legacyModelVersion" TEXT,
ADD COLUMN     "searchRadiusKm" DOUBLE PRECISION,
ADD COLUMN     "selectionPolicy" TEXT,
ADD COLUMN     "shortlistSize" INTEGER,
ADD COLUMN     "workloadPenaltyKm" DOUBLE PRECISION;

-- CreateIndex
CREATE UNIQUE INDEX "DispatchAttempt_dispatchRoundId_riderId_key" ON "DispatchAttempt"("dispatchRoundId", "riderId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchAttempt_dispatchRoundId_deterministicRank_key" ON "DispatchAttempt"("dispatchRoundId", "deterministicRank");
