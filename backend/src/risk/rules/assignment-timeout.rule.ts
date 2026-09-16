import { isRiskFactDate, isRiskFactObject, riskAssignmentStateIssue, riskFactIssue, riskUuid, validateRiskDetection } from "../risk.evidence.js";
import type { OperationalRiskRuleMetadata, OperationalRiskRuleResult, RiskRuleEvaluationContext } from "../risk.types.js";

export const assignmentTimeoutMetadata = Object.freeze({
  ruleCode: "ASSIGNMENT_OFFER_TIMED_OUT", ruleVersion: "1", evidenceSchemaVersion: 1,
  entityType: "DELIVERY_ASSIGNMENT", severity: "INFO", resolutionPolicy: "HISTORICAL_EVENT_ONLY",
} as const satisfies OperationalRiskRuleMetadata);

export interface AssignmentTimeoutFacts extends RiskRuleEvaluationContext {
  readonly assignmentId: string;
  readonly status: string;
  readonly assignedAt: Date;
  readonly offerExpiresAt: Date | null;
  readonly timedOutAt: Date | null;
}

/** Recorded timeout only; never derives a deadline from elapsed time or current configuration. */
export function evaluateAssignmentTimeout(facts: AssignmentTimeoutFacts): OperationalRiskRuleResult {
  if (!isRiskFactObject(facts)) return { status: "unavailable", reason: facts == null ? "missing_required_fact" : "invalid_required_fact" };
  const stateIssue = riskAssignmentStateIssue(facts.status);
  if (stateIssue) return { status: "unavailable", reason: stateIssue };
  if (facts.status !== "TIMED_OUT") return { status: "not_matched" };

  const issue = riskFactIssue(facts.assignmentId, value => riskUuid.safeParse(value).success)
    ?? riskFactIssue(facts.assignedAt, isRiskFactDate)
    ?? riskFactIssue(facts.timedOutAt, isRiskFactDate)
    ?? riskFactIssue(facts.evaluatedAt, isRiskFactDate)
    ?? (facts.offerExpiresAt === null ? null : riskFactIssue(facts.offerExpiresAt, isRiskFactDate))
    ?? (facts.orderId == null ? null : riskFactIssue(facts.orderId, value => riskUuid.safeParse(value).success));
  if (issue) return { status: "unavailable", reason: issue };
  const timedOutAt = facts.timedOutAt!;
  if (timedOutAt < facts.assignedAt || timedOutAt > facts.evaluatedAt ||
      (facts.offerExpiresAt !== null && (facts.offerExpiresAt < facts.assignedAt || timedOutAt < facts.offerExpiresAt))) {
    return { status: "unavailable", reason: "inconsistent_facts" };
  }
  const assignmentId = riskUuid.parse(facts.assignmentId);
  return { status: "matched", detection: validateRiskDetection({
    ...assignmentTimeoutMetadata, entityId: assignmentId, occurrenceKey: assignmentId,
    orderId: facts.orderId ?? null, sourceOccurredAt: timedOutAt,
    detectedAt: facts.evaluatedAt, evaluatedAt: facts.evaluatedAt,
    evidence: { assignmentStatus: "TIMED_OUT", offerExpiresAt: facts.offerExpiresAt?.toISOString() ?? null, timedOutAt: timedOutAt.toISOString() },
  }) };
}
