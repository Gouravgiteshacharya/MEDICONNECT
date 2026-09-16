import { isRiskFactDate, isRiskFactObject, riskAssignmentStateIssue, riskFactIssue, riskOrderStatusAtFailureSchema, riskUuid, validateRiskDetection } from "../risk.evidence.js";
import type { OperationalRiskRuleMetadata, OperationalRiskRuleResult, RiskRuleEvaluationContext } from "../risk.types.js";

export const deliveryFailedMetadata = Object.freeze({
  ruleCode: "DELIVERY_FAILED", ruleVersion: "1", evidenceSchemaVersion: 1,
  entityType: "DELIVERY_ASSIGNMENT", severity: "HIGH", resolutionPolicy: "MANUAL_RESOLUTION",
} as const satisfies OperationalRiskRuleMetadata);

export interface DeliveryFailureEventFacts {
  readonly id: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly orderStatusAtFailure: string;
  readonly requiresManualReview: boolean;
}
export interface DeliveryFailedFacts extends RiskRuleEvaluationContext {
  readonly assignmentId: string;
  readonly assignmentStatus: string;
  /** Trusted reader must supply an event belonging to this assignment. */
  readonly failureEvent: DeliveryFailureEventFacts | null;
}

export function evaluateDeliveryFailed(facts: DeliveryFailedFacts): OperationalRiskRuleResult {
  if (!isRiskFactObject(facts)) return { status: "unavailable", reason: facts == null ? "missing_required_fact" : "invalid_required_fact" };
  const stateIssue = riskAssignmentStateIssue(facts.assignmentStatus);
  if (stateIssue) return { status: "unavailable", reason: stateIssue };
  if (facts.assignmentStatus !== "FAILED") return { status: "not_matched" };
  const eventIssue = riskFactIssue(facts.failureEvent, isRiskFactObject);
  if (eventIssue) return { status: "unavailable", reason: eventIssue };
  const event = facts.failureEvent!;
  const typeIssue = riskFactIssue(event.eventType, value => typeof value === "string" && value.length > 0);
  if (typeIssue) return { status: "unavailable", reason: typeIssue };
  if (event.eventType !== "FAILED_DELIVERY") return { status: "unavailable", reason: "inconsistent_facts" };

  const issue = riskFactIssue(facts.assignmentId, value => riskUuid.safeParse(value).success)
    ?? riskFactIssue(event.id, value => riskUuid.safeParse(value).success)
    ?? riskFactIssue(event.occurredAt, isRiskFactDate)
    ?? riskFactIssue(event.orderStatusAtFailure, value => riskOrderStatusAtFailureSchema.safeParse(value).success)
    ?? riskFactIssue(event.requiresManualReview, value => typeof value === "boolean")
    ?? riskFactIssue(facts.evaluatedAt, isRiskFactDate)
    ?? (facts.orderId == null ? null : riskFactIssue(facts.orderId, value => riskUuid.safeParse(value).success));
  if (issue) return { status: "unavailable", reason: issue };
  if (event.occurredAt > facts.evaluatedAt) return { status: "unavailable", reason: "inconsistent_facts" };
  // v1 represents recorded failures explicitly requiring operational review.
  if (!event.requiresManualReview) return { status: "not_matched" };
  return { status: "matched", detection: validateRiskDetection({
    ...deliveryFailedMetadata, entityId: riskUuid.parse(facts.assignmentId), occurrenceKey: riskUuid.parse(event.id),
    orderId: facts.orderId ?? null, sourceOccurredAt: event.occurredAt,
    detectedAt: facts.evaluatedAt, evaluatedAt: facts.evaluatedAt,
    evidence: { assignmentStatus: "FAILED", eventType: "FAILED_DELIVERY", occurredAt: event.occurredAt.toISOString(), orderStatusAtFailure: event.orderStatusAtFailure, requiresManualReview: true },
  }) };
}
