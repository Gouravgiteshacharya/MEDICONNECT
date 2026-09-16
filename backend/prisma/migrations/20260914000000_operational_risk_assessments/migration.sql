-- CreateEnum
CREATE TYPE "OperationalRiskEntityType" AS ENUM ('ORDER', 'DELIVERY_ASSIGNMENT', 'PRESCRIPTION', 'PHARMACY_INVENTORY');

-- CreateEnum
CREATE TYPE "OperationalRiskSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "OperationalRiskStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "OperationalRiskResolutionPolicy" AS ENUM ('AUTO_RESOLVABLE', 'MANUAL_RESOLUTION', 'HISTORICAL_EVENT_ONLY');

-- CreateTable
CREATE TABLE "OperationalRiskAssessment" (
    "id" UUID NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "evidenceSchemaVersion" INTEGER NOT NULL,
    "entityType" "OperationalRiskEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "orderId" UUID,
    "pharmacyId" UUID,
    "occurrenceKey" TEXT NOT NULL,
    "severity" "OperationalRiskSeverity" NOT NULL,
    "status" "OperationalRiskStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionPolicy" "OperationalRiskResolutionPolicy" NOT NULL,
    "evidence" JSONB NOT NULL,
    "sourceOccurredAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByAdminId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" UUID,
    "dismissedAt" TIMESTAMP(3),
    "dismissedByAdminId" UUID,
    "resolutionReason" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalRiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalRiskAssessment_status_severity_detectedAt_idx" ON "OperationalRiskAssessment"("status", "severity", "detectedAt");

-- CreateIndex
CREATE INDEX "OperationalRiskAssessment_entityType_entityId_detectedAt_idx" ON "OperationalRiskAssessment"("entityType", "entityId", "detectedAt");

-- CreateIndex
CREATE INDEX "OperationalRiskAssessment_orderId_detectedAt_idx" ON "OperationalRiskAssessment"("orderId", "detectedAt");

-- CreateIndex
CREATE INDEX "OperationalRiskAssessment_pharmacyId_detectedAt_idx" ON "OperationalRiskAssessment"("pharmacyId", "detectedAt");

-- CreateIndex
CREATE INDEX "OperationalRiskAssessment_ruleCode_status_idx" ON "OperationalRiskAssessment"("ruleCode", "status");

-- CreateIndex
CREATE INDEX "OperationalRiskAssessment_acknowledgedByAdminId_idx" ON "OperationalRiskAssessment"("acknowledgedByAdminId");

-- CreateIndex
CREATE INDEX "OperationalRiskAssessment_resolvedByAdminId_idx" ON "OperationalRiskAssessment"("resolvedByAdminId");

-- CreateIndex
CREATE INDEX "OperationalRiskAssessment_dismissedByAdminId_idx" ON "OperationalRiskAssessment"("dismissedByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "operational_risk_occurrence_key" ON "OperationalRiskAssessment"("ruleCode", "ruleVersion", "entityType", "entityId", "occurrenceKey");

-- AddForeignKey
ALTER TABLE "OperationalRiskAssessment" ADD CONSTRAINT "OperationalRiskAssessment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalRiskAssessment" ADD CONSTRAINT "OperationalRiskAssessment_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalRiskAssessment" ADD CONSTRAINT "OperationalRiskAssessment_acknowledgedByAdminId_fkey" FOREIGN KEY ("acknowledgedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalRiskAssessment" ADD CONSTRAINT "OperationalRiskAssessment_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalRiskAssessment" ADD CONSTRAINT "OperationalRiskAssessment_dismissedByAdminId_fkey" FOREIGN KEY ("dismissedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
