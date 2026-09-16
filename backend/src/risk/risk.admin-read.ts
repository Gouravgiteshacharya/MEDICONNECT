import { z } from "zod";
import { riskCode, riskIdentitySchema, riskUuid, validateRiskEvidence, type RiskEvidence } from "./risk.evidence.js";
import { OperationalRiskError } from "./risk.types.js";

const metadataSchema = z.object({
  id: riskUuid, ruleCode: riskCode, ruleVersion: riskIdentitySchema.shape.ruleVersion,
  evidenceSchemaVersion: z.number().int().positive().max(2147483647),
  entityType: riskIdentitySchema.shape.entityType,
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH"]),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]),
  resolutionPolicy: z.enum(["AUTO_RESOLVABLE", "MANUAL_RESOLUTION", "HISTORICAL_EVENT_ONLY"]),
  detectedAt: z.date(), lastEvaluatedAt: z.date(), acknowledgedAt: z.date().nullable(),
  resolvedAt: z.date().nullable(), dismissedAt: z.date().nullable(),
  resolutionReason: z.enum(["CONDITION_CLEARED", "OPERATOR_RESOLVED", "FALSE_POSITIVE", "DUPLICATE_CONTEXT"]).nullable(),
  revision: z.number().int().min(0).max(2147483647),
}).refine(row => row.lastEvaluatedAt >= row.detectedAt);

export type AdminOperationalRiskMetadata = z.infer<typeof metadataSchema>;
export type AdminOperationalRiskEvidenceResult =
  | { status: "available"; evidence: RiskEvidence }
  | { status: "unavailable"; reason: "unknown_rule" | "invalid_evidence" };
export interface AdminOperationalRiskRecord extends AdminOperationalRiskMetadata {
  evidence: AdminOperationalRiskEvidenceResult;
}

/** Queue queries fetch no evidence or domain/actor linkage identifiers. */
export const adminRiskMetadataSelect = {
  id: true, ruleCode: true, ruleVersion: true, evidenceSchemaVersion: true, entityType: true,
  severity: true, status: true, resolutionPolicy: true, detectedAt: true, lastEvaluatedAt: true,
  acknowledgedAt: true, resolvedAt: true, dismissedAt: true, resolutionReason: true, revision: true,
} as const;

export function toAdminRiskMetadata(value: unknown): AdminOperationalRiskMetadata {
  const result = metadataSchema.safeParse(value);
  if (!result.success) throw new OperationalRiskError("PERSISTENCE_FAILED");
  // z.object strips unlisted fields. Returned metadata is detached, never a Prisma row.
  return structuredClone(result.data);
}

/** Tolerance is only for admin observability, never detection or lifecycle semantics. */
export function toAdminRiskEvidence(ruleCode: string, schemaVersion: number, value: unknown): AdminOperationalRiskEvidenceResult {
  if (!["ASSIGNMENT_OFFER_TIMED_OUT", "DELIVERY_FAILED", "RIDER_LOCATION_STALE"].includes(ruleCode)) return { status: "unavailable", reason: "unknown_rule" };
  let evidence: RiskEvidence;
  try { evidence = validateRiskEvidence(ruleCode, schemaVersion, value); }
  catch (error) {
    if (error instanceof OperationalRiskError && error.code === "INVALID_INPUT") return { status: "unavailable", reason: "invalid_evidence" };
    throw error;
  }
  switch (ruleCode) {
    case "ASSIGNMENT_OFFER_TIMED_OUT":
      if ("timedOutAt" in evidence) return { status: "available", evidence: { assignmentStatus: "TIMED_OUT", offerExpiresAt: evidence.offerExpiresAt, timedOutAt: evidence.timedOutAt } };
      break;
    case "DELIVERY_FAILED":
      if ("occurredAt" in evidence) return { status: "available", evidence: { assignmentStatus: "FAILED", eventType: "FAILED_DELIVERY", occurredAt: evidence.occurredAt, orderStatusAtFailure: evidence.orderStatusAtFailure, requiresManualReview: true } };
      break;
    case "RIDER_LOCATION_STALE":
      if ("lastLocationAt" in evidence) return { status: "available", evidence: { assignmentStatus: evidence.assignmentStatus, locationFreshness: "STALE", lastLocationAt: evidence.lastLocationAt, freshnessThresholdMs: evidence.freshnessThresholdMs, evaluatedAt: evidence.evaluatedAt } };
      break;
  }
  return { status: "unavailable", reason: "invalid_evidence" };
}
