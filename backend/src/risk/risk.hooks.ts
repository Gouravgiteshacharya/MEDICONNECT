import { evaluateAssignmentTimeout, evaluateDeliveryFailed, evaluateRiderLocationStale, type AssignmentTimeoutFacts, type DeliveryFailedFacts, type RiderLocationStaleFacts } from "./risk.rules.js";
import { isRiskFactDate, riskUuid, validateRiskEvidence } from "./risk.evidence.js";
import { activeLocationAssignmentStates } from "./rules/rider-location-stale.rule.js";
import type { OperationalRiskAssessmentRecord, OperationalRiskDetection, OperationalRiskLifecycleResult, OperationalRiskRuleResult, RiskLifecycleInput, RiskPage } from "./risk.types.js";

export interface OperationalRiskServiceLike {
  recordDetection(input: OperationalRiskDetection): Promise<OperationalRiskAssessmentRecord>;
  listByOrder(orderId: string, page?: RiskPage): Promise<OperationalRiskAssessmentRecord[]>;
  resolveAssessment(input: RiskLifecycleInput): Promise<OperationalRiskLifecycleResult>;
}
export interface SafeRiskHookError {
  operation: "record_detection" | "auto_resolve";
  ruleCode: "ASSIGNMENT_OFFER_TIMED_OUT" | "DELIVERY_FAILED" | "RIDER_LOCATION_STALE";
  reason: "service_unavailable" | "evaluation_unavailable" | "persistence_failed";
}
export interface ActiveRiskAssignment { assignmentId: string; assignmentStatus: string; orderId: string; }
export interface RiskHookDependencies {
  riskService?: OperationalRiskServiceLike;
  readActiveRiskAssignments?: (riderId: string) => Promise<ActiveRiskAssignment[]>;
  onRiskHookError?: (event: SafeRiskHookError) => void | Promise<void>;
}
export interface RiskLocationUpdate {
  riderId: string;
  lastLocationAt: Date | null;
  evaluatedAt: Date;
  freshnessThresholdMs: number;
}
export interface RiskHooks {
  assignmentTimedOut(facts: AssignmentTimeoutFacts): Promise<void>;
  deliveryFailed(facts: DeliveryFailedFacts): Promise<void>;
  observeLocation(facts: RiderLocationStaleFacts): Promise<void>;
  locationUpdated(facts: RiskLocationUpdate): Promise<void>;
}

/** Last integration guard also isolates a faulty injected hook or fact adapter. */
export async function runRiskHook(work: () => Promise<void> | undefined): Promise<void> {
  try { await work(); } catch { /* Secondary work never changes a domain outcome. */ }
}

export function createRiskHooks(dependencies: RiskHookDependencies = {}): RiskHooks {
  const { riskService: service, readActiveRiskAssignments, onRiskHookError } = dependencies;
  async function report(event: SafeRiskHookError) {
    try { await onRiskHookError?.({ operation: event.operation, ruleCode: event.ruleCode, reason: event.reason }); } catch { /* Observers are secondary too. */ }
  }
  async function record(ruleCode: SafeRiskHookError["ruleCode"], evaluate: () => OperationalRiskRuleResult) {
    if (!service) return; // Disabled is an intentional no-op, not an operational error.
    try {
      const result = evaluate();
      if (result.status === "unavailable") await report({ operation: "record_detection", ruleCode, reason: "evaluation_unavailable" });
      if (result.status === "matched") await service.recordDetection(result.detection);
    } catch { await report({ operation: "record_detection", ruleCode, reason: "persistence_failed" }); }
  }

  async function recover(facts: RiderLocationStaleFacts) {
    if (!service) return;
    const result = evaluateRiderLocationStale(facts);
    if (result.status === "unavailable") { await report({ operation: "auto_resolve", ruleCode: "RIDER_LOCATION_STALE", reason: "evaluation_unavailable" }); return; }
    // not_matched alone does not prove recovery: inactive states are also not_matched.
    if (result.status !== "not_matched" || !(activeLocationAssignmentStates as readonly string[]).includes(facts.assignmentStatus) || !isRiskFactDate(facts.lastLocationAt) || !riskUuid.safeParse(facts.orderId).success) return;
    const assignmentId = riskUuid.parse(facts.assignmentId);
    const orderId = riskUuid.parse(facts.orderId);
    const candidates: OperationalRiskAssessmentRecord[] = [];
    // Read before writes: resolving rows cannot shift our offset pages. Concurrent inserts
    // may still leave missed rows for reconciliation, but never authorize broader resolution.
    for (let offset = 0; offset <= 1_000_000; offset += 100) {
      const rows = await service.listByOrder(orderId, { limit: 100, offset });
      for (const row of rows) {
        if (row.orderId !== orderId || row.entityType !== "DELIVERY_ASSIGNMENT" || row.entityId !== assignmentId ||
            row.ruleCode !== "RIDER_LOCATION_STALE" || row.ruleVersion !== "1" || row.evidenceSchemaVersion !== 1 ||
            row.resolutionPolicy !== "AUTO_RESOLVABLE" || !["OPEN", "ACKNOWLEDGED"].includes(row.status)) continue;
        const evidence = validateRiskEvidence(row.ruleCode, row.evidenceSchemaVersion, row.evidence);
        if (!("lastLocationAt" in evidence)) continue;
        const anchor = new Date(evidence.lastLocationAt);
        const observedAt = new Date(evidence.evaluatedAt);
        const original = evaluateRiderLocationStale({ assignmentId, orderId, assignmentStatus: evidence.assignmentStatus, lastLocationAt: anchor, evaluatedAt: observedAt, freshnessThresholdMs: evidence.freshnessThresholdMs });
        // An old callback must not clear a newer anchor, observation, or revision.
        if (original.status !== "matched" || row.occurrenceKey !== original.detection.occurrenceKey || anchor >= facts.lastLocationAt || observedAt > facts.evaluatedAt ||
            !isRiskFactDate(row.detectedAt) || !isRiskFactDate(row.lastEvaluatedAt) ||
            row.detectedAt > facts.evaluatedAt || row.lastEvaluatedAt > facts.evaluatedAt) continue;
        candidates.push(row);
      }
      if (rows.length < 100) break;
    }
    for (const row of candidates) {
      await service.resolveAssessment({ id: row.id, expectedRevision: row.revision, at: facts.evaluatedAt, actorId: null, reason: "CONDITION_CLEARED" });
      // Conflicts are not retried with a newer revision; reconciliation can re-read later.
    }
  }

  return {
    assignmentTimedOut: facts => record("ASSIGNMENT_OFFER_TIMED_OUT", () => evaluateAssignmentTimeout(facts)),
    deliveryFailed: facts => record("DELIVERY_FAILED", () => evaluateDeliveryFailed(facts)),
    observeLocation: facts => record("RIDER_LOCATION_STALE", () => evaluateRiderLocationStale(facts)),
    async locationUpdated(facts) {
      if (!service) return;
      try {
        if (!isRiskFactDate(facts.lastLocationAt) || !isRiskFactDate(facts.evaluatedAt) || !riskUuid.safeParse(facts.riderId).success) {
          await report({ operation: "auto_resolve", ruleCode: "RIDER_LOCATION_STALE", reason: "evaluation_unavailable" }); return;
        }
        if (!readActiveRiskAssignments) { await report({ operation: "auto_resolve", ruleCode: "RIDER_LOCATION_STALE", reason: "service_unavailable" }); return; }
        const assignments = await readActiveRiskAssignments(facts.riderId);
        for (const assignment of assignments) await recover({ assignmentId: assignment.assignmentId, assignmentStatus: assignment.assignmentStatus, orderId: assignment.orderId, lastLocationAt: facts.lastLocationAt, freshnessThresholdMs: facts.freshnessThresholdMs, evaluatedAt: facts.evaluatedAt });
      } catch { await report({ operation: "auto_resolve", ruleCode: "RIDER_LOCATION_STALE", reason: "persistence_failed" }); }
    },
  };
}
