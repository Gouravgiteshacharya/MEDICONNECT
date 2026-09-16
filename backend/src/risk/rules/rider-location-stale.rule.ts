import { classifyLocationFreshness } from "../../location/freshness.js";
import { isRiskFactDate, isRiskFactObject, riskAssignmentStateIssue, riskFactIssue, riskUuid, validateRiskDetection } from "../risk.evidence.js";
import type { OperationalRiskRuleMetadata, OperationalRiskRuleResult, RiskRuleEvaluationContext } from "../risk.types.js";

export const riderLocationStaleMetadata = Object.freeze({
  ruleCode: "RIDER_LOCATION_STALE", ruleVersion: "1", evidenceSchemaVersion: 1,
  entityType: "DELIVERY_ASSIGNMENT", severity: "LOW", resolutionPolicy: "AUTO_RESOLVABLE",
} as const satisfies OperationalRiskRuleMetadata);

export const activeLocationAssignmentStates = Object.freeze(["ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"] as const);
export interface RiderLocationStaleFacts extends RiskRuleEvaluationContext {
  readonly assignmentId: string;
  readonly assignmentStatus: string;
  readonly lastLocationAt: Date | null;
  readonly freshnessThresholdMs: number;
}

export function evaluateRiderLocationStale(facts: RiderLocationStaleFacts): OperationalRiskRuleResult {
  if (!isRiskFactObject(facts)) return { status: "unavailable", reason: facts == null ? "missing_required_fact" : "invalid_required_fact" };
  const stateIssue = riskAssignmentStateIssue(facts.assignmentStatus);
  if (stateIssue) return { status: "unavailable", reason: stateIssue };
  if (!(activeLocationAssignmentStates as readonly string[]).includes(facts.assignmentStatus)) return { status: "not_matched" };

  const issue = riskFactIssue(facts.assignmentId, value => riskUuid.safeParse(value).success)
    ?? riskFactIssue(facts.lastLocationAt, isRiskFactDate)
    ?? riskFactIssue(facts.evaluatedAt, isRiskFactDate)
    ?? riskFactIssue(facts.freshnessThresholdMs, value => typeof value === "number" && Number.isFinite(value) && value >= 0)
    ?? (facts.orderId == null ? null : riskFactIssue(facts.orderId, value => riskUuid.safeParse(value).success));
  if (issue) return { status: "unavailable", reason: issue };
  const lastLocationAt = facts.lastLocationAt!;
  if (lastLocationAt > facts.evaluatedAt) return { status: "unavailable", reason: "inconsistent_facts" };
  // Always supply now: the helper's optional wall-clock fallback is never used.
  if (classifyLocationFreshness(lastLocationAt, { now: facts.evaluatedAt, freshForMs: facts.freshnessThresholdMs }) === "FRESH") return { status: "not_matched" };
  const assignmentId = riskUuid.parse(facts.assignmentId);
  // Extended positive ISO years start with '+', which is outside the occurrence-key alphabet.
  const episodeAnchor = lastLocationAt.toISOString().replace(/^\+/, "");
  return { status: "matched", detection: validateRiskDetection({
    ...riderLocationStaleMetadata, entityId: assignmentId,
    occurrenceKey: `${assignmentId}:${episodeAnchor}`,
    orderId: facts.orderId ?? null, sourceOccurredAt: null,
    detectedAt: facts.evaluatedAt, evaluatedAt: facts.evaluatedAt,
    evidence: { assignmentStatus: facts.assignmentStatus, locationFreshness: "STALE", lastLocationAt: lastLocationAt.toISOString(), freshnessThresholdMs: facts.freshnessThresholdMs, evaluatedAt: facts.evaluatedAt.toISOString() },
  }) };
}
