import type { RiskEvidence } from "./risk.evidence.js";

export type OperationalRiskEntityType = "ORDER" | "DELIVERY_ASSIGNMENT" | "PRESCRIPTION" | "PHARMACY_INVENTORY";
export type OperationalRiskSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH";
export type OperationalRiskStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";
export type OperationalRiskResolutionPolicy = "AUTO_RESOLVABLE" | "MANUAL_RESOLUTION" | "HISTORICAL_EVENT_ONLY";
export type OperationalRiskResolutionReason = "CONDITION_CLEARED" | "OPERATOR_RESOLVED" | "FALSE_POSITIVE" | "DUPLICATE_CONTEXT";

export interface OperationalRiskOccurrenceIdentity {
  ruleCode: string;
  ruleVersion: string;
  entityType: OperationalRiskEntityType;
  entityId: string;
  occurrenceKey: string;
}

export interface OperationalRiskDetection extends OperationalRiskOccurrenceIdentity {
  evidenceSchemaVersion: number;
  orderId?: string | null;
  pharmacyId?: string | null;
  severity: OperationalRiskSeverity;
  resolutionPolicy: OperationalRiskResolutionPolicy;
  evidence: RiskEvidence;
  sourceOccurredAt?: Date | null;
  detectedAt: Date;
  evaluatedAt: Date;
}

export interface OperationalRiskAssessmentRecord extends OperationalRiskOccurrenceIdentity {
  id: string;
  evidenceSchemaVersion: number;
  orderId: string | null;
  pharmacyId: string | null;
  severity: OperationalRiskSeverity;
  status: OperationalRiskStatus;
  resolutionPolicy: OperationalRiskResolutionPolicy;
  evidence: RiskEvidence;
  sourceOccurredAt: Date | null;
  detectedAt: Date;
  lastEvaluatedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedByAdminId: string | null;
  resolvedAt: Date | null;
  resolvedByAdminId: string | null;
  dismissedAt: Date | null;
  dismissedByAdminId: string | null;
  resolutionReason: OperationalRiskResolutionReason | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export type OperationalRiskLifecycleResult =
  | { status: "updated" | "idempotent"; record: OperationalRiskAssessmentRecord }
  | { status: "conflict"; record: OperationalRiskAssessmentRecord }
  | { status: "not_found" };

export type RiskRuleUnavailableReason = "missing_required_fact" | "invalid_required_fact" | "inconsistent_facts" | "unsupported_state";
export type OperationalRiskRuleResult =
  | { status: "matched"; detection: OperationalRiskDetection }
  | { status: "not_matched" }
  | { status: "unavailable"; reason: RiskRuleUnavailableReason };

export interface OperationalRiskRuleMetadata {
  readonly ruleCode: string;
  readonly ruleVersion: string;
  readonly evidenceSchemaVersion: number;
  readonly severity: OperationalRiskSeverity;
  readonly resolutionPolicy: OperationalRiskResolutionPolicy;
  readonly entityType: OperationalRiskEntityType;
}

/** Explicit evaluation time; optional linkage must already come from a trusted reader. */
export interface RiskRuleEvaluationContext {
  readonly evaluatedAt: Date;
  readonly orderId?: string | null;
}

/** Trusted internal callers supply authorized actors; UUID validation is not authorization. */
export interface RiskLifecycleInput {
  id: string;
  expectedRevision: number;
  at: Date;
  actorId: string | null;
  reason?: OperationalRiskResolutionReason;
}

export interface RiskPage { limit?: number; offset?: number }
export interface RiskOpenQuery extends RiskPage {
  severity?: OperationalRiskSeverity;
  ruleCode?: string;
}

export class OperationalRiskError extends Error {
  constructor(public readonly code: "INVALID_INPUT" | "PERSISTENCE_FAILED") {
    super(code === "INVALID_INPUT" ? "Invalid operational risk input" : "Operational risk persistence failed");
    this.name = "OperationalRiskError";
  }
}
