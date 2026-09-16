import { z } from "zod";
import { isRiskFactDate, riskUuid, validateRiskEvidence } from "./risk.evidence.js";
import { evaluateAssignmentTimeout, evaluateDeliveryFailed, evaluateRiderLocationStale, type AssignmentTimeoutFacts, type DeliveryFailedFacts } from "./risk.rules.js";
import { activeLocationAssignmentStates } from "./rules/rider-location-stale.rule.js";
import type { OperationalRiskService } from "./risk.service.js";
import type { OperationalRiskAssessmentRecord, OperationalRiskRuleResult } from "./risk.types.js";

export const reconciliationLanes = ["timeouts", "failures", "locations", "recovery"] as const;
export type ReconciliationLane = typeof reconciliationLanes[number];
const iso = z.string().refine(s => { const d = new Date(s); return isRiskFactDate(d) && d.toISOString() === s; });
const cursorSchema = z.strictObject({ at: iso, consumedAtTime: z.number().int().min(1).max(1_000_000) });
export type ReconciliationCursor = z.infer<typeof cursorSchema>;
const optionsSchema = z.strictObject({
  lane: z.enum(reconciliationLanes), evaluatedAt: z.date(),
  freshnessThresholdMs: z.number().finite().nonnegative(), batchSize: z.number().int().min(1).max(100).default(25),
  cursor: cursorSchema.nullish(),
}).refine(o => !o.cursor || new Date(o.cursor.at) <= o.evaluatedAt);
export interface ReconciliationOptions {
  lane: ReconciliationLane; evaluatedAt: Date; freshnessThresholdMs: number;
  batchSize?: number; cursor?: ReconciliationCursor | null;
}
export interface LocationAssignment {
  assignmentId: string; orderId: string; assignmentStatus: string;
  assignedAt: Date; updatedAt: Date; lastLocationAt: Date | null;
}
export type ReconciliationCandidate = { at: Date } & (
  | { lane: "timeouts"; facts: Omit<AssignmentTimeoutFacts, "evaluatedAt"> }
  | { lane: "failures"; facts: Omit<DeliveryFailedFacts, "evaluatedAt"> }
  | { lane: "locations"; facts: LocationAssignment }
  | { lane: "recovery"; assessmentId: string }
);
/** Internal linkage stays in this read-only boundary, never in aggregate results. */
export interface ReconciliationSource {
  readPage(options: Required<Omit<ReconciliationOptions, "cursor">> & { cursor: ReconciliationCursor | null }): Promise<ReconciliationCandidate[]>;
  readAssignment(id: string): Promise<LocationAssignment | null>;
}
export class RiskReconciliationError extends Error {
  constructor(public readonly code: "INVALID_OPTIONS" | "SOURCE_UNAVAILABLE") {
    super(code === "INVALID_OPTIONS" ? "Invalid risk reconciliation options" : "Risk reconciliation source unavailable");
    this.name = "RiskReconciliationError";
  }
}
export interface ReconciliationResult {
  scanned: number; matched: number; recorded: number; resolved: number; idempotent: number;
  unavailable: number; skipped: number; failures: number;
  continuation: ReconciliationCursor | null; more: boolean; continuationLimitReached: boolean;
}
const terminal = new Set(["DELIVERED", "FAILED", "TIMED_OUT", "DECLINED", "CANCELLED", "REASSIGNED"]);
function validAssignment(a: LocationAssignment, evaluatedAt: Date) {
  return riskUuid.safeParse(a.assignmentId).success && riskUuid.safeParse(a.orderId).success &&
    isRiskFactDate(a.assignedAt) && isRiskFactDate(a.updatedAt) && a.assignedAt <= a.updatedAt && a.updatedAt <= evaluatedAt;
}

/** Same episode validation and chronology safeguards as Phase 13C recovery. */
function recoverableEpisode(row: OperationalRiskAssessmentRecord, a: LocationAssignment, evaluatedAt: Date) {
  if (row.entityType !== "DELIVERY_ASSIGNMENT" || row.entityId !== a.assignmentId || row.orderId !== a.orderId ||
      row.ruleCode !== "RIDER_LOCATION_STALE" || row.ruleVersion !== "1" || row.evidenceSchemaVersion !== 1 ||
      row.resolutionPolicy !== "AUTO_RESOLVABLE" || !["OPEN", "ACKNOWLEDGED"].includes(row.status)) return null;
  const evidence = validateRiskEvidence(row.ruleCode, row.evidenceSchemaVersion, row.evidence);
  if (!("lastLocationAt" in evidence)) return null;
  const anchor = new Date(evidence.lastLocationAt), observedAt = new Date(evidence.evaluatedAt);
  const original = evaluateRiderLocationStale({ assignmentId: a.assignmentId, orderId: a.orderId,
    assignmentStatus: evidence.assignmentStatus, lastLocationAt: anchor, evaluatedAt: observedAt,
    freshnessThresholdMs: evidence.freshnessThresholdMs });
  if (original.status !== "matched" || row.occurrenceKey !== original.detection.occurrenceKey || observedAt > evaluatedAt ||
      !isRiskFactDate(row.detectedAt) || !isRiskFactDate(row.lastEvaluatedAt) || row.detectedAt > evaluatedAt || row.lastEvaluatedAt > evaluatedAt) return null;
  return anchor;
}

export function createRiskReconciler(source: ReconciliationSource, service: Pick<OperationalRiskService, "recordDetection" | "getById" | "resolveAssessment">) {
  return async function reconcile(input: ReconciliationOptions): Promise<ReconciliationResult> {
    const parsed = optionsSchema.safeParse(input);
    if (!parsed.success) throw new RiskReconciliationError("INVALID_OPTIONS");
    const options = structuredClone({ ...parsed.data, cursor: parsed.data.cursor ?? null });
    let rows: ReconciliationCandidate[];
    try {
      rows = await source.readPage(options);
      // One bounded page plus one lookahead; never trust an injected reader to expand work.
      if (!Array.isArray(rows) || rows.length > options.batchSize + 1 || rows.some((r, i) =>
        !isRiskFactDate(r.at) || r.at > options.evaluatedAt || r.lane !== options.lane ||
        (options.cursor && r.at < new Date(options.cursor.at)) || (i > 0 && r.at < rows[i - 1]!.at))) throw new Error();
    } catch { throw new RiskReconciliationError("SOURCE_UNAVAILABLE"); }
    const result: ReconciliationResult = { scanned: 0, matched: 0, recorded: 0, resolved: 0, idempotent: 0,
      unavailable: 0, skipped: 0, failures: 0, continuation: null, more: rows.length > options.batchSize, continuationLimitReached: false };
    const page = rows.slice(0, options.batchSize);
    if (result.more) {
      const at = page[page.length - 1]!.at.toISOString();
      const consumedAtTime = page.filter(r => r.at.toISOString() === at).length + (options.cursor?.at === at ? options.cursor.consumedAtTime : 0);
      if (consumedAtTime > 1_000_000) result.continuationLimitReached = true;
      else result.continuation = { at, consumedAtTime };
    }
    async function record(decision: OperationalRiskRuleResult) {
      if (decision.status === "unavailable") { result.unavailable++; return; }
      if (decision.status === "not_matched") { result.skipped++; return; }
      result.matched++;
      await service.recordDetection(decision.detection);
      // Existing service returns a record, not inserted/duplicate provenance. Count successful
      // create-or-get calls together rather than guessing which concurrent caller inserted it.
      result.recorded++;
    }
    for (const row of page) {
      result.scanned++;
      try {
        if (row.lane === "timeouts") await record(evaluateAssignmentTimeout({ ...row.facts, evaluatedAt: options.evaluatedAt }));
        else if (row.lane === "failures") await record(evaluateDeliveryFailed({ ...row.facts, evaluatedAt: options.evaluatedAt }));
        else if (row.lane === "locations") {
          if (!validAssignment(row.facts, options.evaluatedAt)) { result.unavailable++; continue; }
          await record(evaluateRiderLocationStale({ ...row.facts, evaluatedAt: options.evaluatedAt, freshnessThresholdMs: options.freshnessThresholdMs }));
        } else {
          const assessment = await service.getById(row.assessmentId);
          if (!assessment || !["OPEN", "ACKNOWLEDGED"].includes(assessment.status) || assessment.ruleCode !== "RIDER_LOCATION_STALE") { result.skipped++; continue; }
          const a = await source.readAssignment(assessment.entityId);
          if (!a || !validAssignment(a, options.evaluatedAt)) { result.unavailable++; continue; }
          const anchor = recoverableEpisode(assessment, a, options.evaluatedAt);
          if (!anchor) { result.skipped++; continue; }
          if (!terminal.has(a.assignmentStatus)) {
            const current = evaluateRiderLocationStale({ ...a, evaluatedAt: options.evaluatedAt, freshnessThresholdMs: options.freshnessThresholdMs });
            if (current.status === "unavailable") { result.unavailable++; continue; }
            if (!(activeLocationAssignmentStates as readonly string[]).includes(a.assignmentStatus) || current.status !== "not_matched" ||
                !isRiskFactDate(a.lastLocationAt) || anchor >= a.lastLocationAt) { result.skipped++; continue; }
          }
          const outcome = await service.resolveAssessment({ id: assessment.id, expectedRevision: assessment.revision,
            at: options.evaluatedAt, actorId: null, reason: "CONDITION_CLEARED" });
          if (outcome.status === "updated") result.resolved++;
          else if (outcome.status === "idempotent") result.idempotent++;
          else result.skipped++;
        }
      } catch { result.failures++; }
    }
    return result;
  };
}
