import { DISPATCH_DATASET_SCHEMA_VERSION, DISPATCH_EXCLUSION_REASONS, type DispatchAcceptanceDatasetRow,
  type DispatchDatasetOptions, type DispatchDatasetSource, type DispatchExclusionReason, type DispatchSplit } from "./dispatch-dataset.types.js";

const time = (d: Date | null): number => d instanceof Date ? d.getTime() : NaN;
const finite = (n: number | null): n is number => typeof n === "number" && Number.isFinite(n);
const text = (s: string | null): s is string => typeof s === "string" && s.trim().length > 0;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function validateDispatchDatasetOptions(o: DispatchDatasetOptions): void {
  const values = [o.trainStart, o.validationStart, o.testStart, o.testEnd, o.outcomeCutoff].map(time);
  if (!values.every(Number.isFinite) || !(values[0] < values[1] && values[1] < values[2] && values[2] < values[3])
    || !Number.isInteger(o.timezoneOffsetMinutes) || o.timezoneOffsetMinutes < -720 || o.timezoneOffsetMinutes > 840) throw new RangeError("Invalid dataset windows, cutoff or fixed offset");
}

/** Exactly one primary exclusion per source. No I/O, ambient time, identity hashing or input mutation. */
export function extractDispatchDataset(sources: readonly DispatchDatasetSource[], options: DispatchDatasetOptions) {
  validateDispatchDatasetOptions(options);
  const cutoff = time(options.outcomeCutoff);
  const splitAt = (t: number): DispatchSplit | "outside" => t < time(options.trainStart) || t >= time(options.testEnd) ? "outside"
    : t < time(options.validationStart) ? "train" : t < time(options.testStart) ? "validation" : "test";
  const byReason = Object.fromEntries(DISPATCH_EXCLUSION_REASONS.map(r => [r, 0])) as Record<DispatchExclusionReason, number>;
  const maps = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  const keys = (s: DispatchDatasetSource) => [s.candidateId, s.dispatchRoundId ? JSON.stringify([s.dispatchRoundId, s.riderId]) : null, s.assignmentId, s.assignment?.id ?? null];
  for (const s of sources) keys(s).forEach((key, i) => { if (key) maps[i].set(key, (maps[i].get(key) ?? 0) + 1); });
  const prelim = (s: DispatchDatasetSource): DispatchExclusionReason | null => {
    if (keys(s).some((key, i) => key && maps[i].get(key)! > 1)) return "duplicate_offer_mapping";
    if (!text(s.dispatchRoundId)) return "missing_round_id";
    if (!text(s.candidateId) || !text(s.orderId) || !text(s.riderId) || !Number.isInteger(s.deterministicRank) || s.deterministicRank! < 1
      || !finite(s.workloadPenaltyKm) || s.workloadPenaltyKm < 0 || !Number.isInteger(s.shortlistSize) || s.shortlistSize! < 1
      || s.deterministicRank! > s.shortlistSize! || !finite(s.searchRadiusKm) || s.searchRadiusKm <= 0
      || !finite(s.freshnessThresholdMs) || s.freshnessThresholdMs < 0 || !text(s.dispatchPolicyVersion) || !text(s.selectionPolicy)) return "instrumentation_incomplete";
    if (["CANDIDATE", "SKIPPED"].includes(s.status)) return "unoffered_candidate";
    if (!s.assignment || !text(s.assignmentId)) return "missing_assignment";
    if (s.assignment.id !== s.assignmentId || s.assignment.orderId !== s.orderId || s.assignment.riderId !== s.riderId) return "invalid_offer_mapping";
    if (s.dispatchPolicyVersion !== "deterministic-dispatch-v1" || !["DETERMINISTIC_FALLBACK", "ML_ASSISTED"].includes(s.selectionPolicy)) return "invalid_policy";
    if (!Number.isFinite(time(s.attemptedAt))) return "invalid_attempted_at";
    if (!Number.isFinite(time(s.assignment.assignedAt)) || time(s.attemptedAt) > time(s.assignment.assignedAt)) return "invalid_assigned_at";
    return null;
  };
  const initial = sources.map(prelim);
  // Structurally eligible offers determine chain boundaries, even if a later
  // label/feature check excludes an individual offer. Never hide future offers.
  const groupSplits = new Map<string, Set<string>>();
  sources.forEach((s, i) => { if (!initial[i]) { const set = groupSplits.get(s.orderId) ?? new Set(); set.add(splitAt(time(s.attemptedAt))); groupSplits.set(s.orderId, set); } });
  const included: { source: DispatchDatasetSource; split: DispatchSplit; outcome: "accepted" | "declined" | "timedOut" }[] = [];
  const classify = (s: DispatchDatasetSource): DispatchExclusionReason | "accepted" | "declined" | "timedOut" => {
    const a = s.assignment!;
    if (groupSplits.get(s.orderId)!.size > 1) return "cross_split_order_group";
    if (splitAt(time(s.attemptedAt)) === "outside") return "outside_split_window";
    if (a.offerExpiresAt === null) return "missing_offer_deadline";
    const assigned = time(a.assignedAt), deadline = time(a.offerExpiresAt);
    if (!Number.isFinite(deadline) || deadline <= assigned) return "invalid_offer_deadline";
    if (!finite(s.riderDistanceKm) || s.riderDistanceKm < 0) return "invalid_distance";
    if (!Number.isInteger(s.workloadAtDispatch) || s.workloadAtDispatch! < 0) return "invalid_workload";
    const hasAccept = a.acceptedAt !== null, hasDecline = a.declinedAt !== null, hasTimeout = a.timedOutAt !== null;
    const decision = hasAccept ? time(a.acceptedAt) : hasDecline ? time(a.declinedAt) : deadline;
    if (assigned > cutoff || deadline > cutoff && !hasAccept && !hasDecline || Number.isFinite(decision) && decision > cutoff
      || hasTimeout && Number.isFinite(time(a.timedOutAt)) && time(a.timedOutAt) > cutoff) return "outcome_not_mature";
    if (Number(hasAccept) + Number(hasDecline) + Number(hasTimeout) > 1) return "conflicting_outcome";
    const interventions = [a.cancelledAt, a.reassignedAt, s.orderCancelledAt];
    if (interventions.some(d => d !== null && (!Number.isFinite(time(d)) || time(d) <= decision))
      || a.status === "CANCELLED" && !a.cancelledAt || a.status === "REASSIGNED" && !a.reassignedAt
      || s.orderStatus === "CANCELLED" && !s.orderCancelledAt) return "administrative_outcome_ambiguous";
    if (hasAccept) {
      if (!Number.isFinite(decision) || decision < assigned || decision >= deadline || s.status !== "ACCEPTED"
        || !["ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED", "CANCELLED", "REASSIGNED"].includes(a.status)) return "invalid_acceptance";
      return "accepted";
    }
    if (hasDecline) {
      if (!Number.isFinite(decision) || decision <= assigned || decision >= deadline || s.status !== "DECLINED" || a.status !== "DECLINED") return "invalid_decline";
      return "declined";
    }
    if (a.status === "OFFERED" && s.status === "OFFERED" && !hasTimeout) return "outcome_not_mature";
    if (!hasTimeout || !Number.isFinite(time(a.timedOutAt)) || time(a.timedOutAt) < deadline || cutoff < deadline
      || a.status !== "TIMED_OUT" || s.status !== "TIMED_OUT") return "invalid_timeout";
    return "timedOut";
  };
  sources.forEach((s, i) => {
    const result = initial[i] ?? classify(s);
    if (result === "accepted" || result === "declined" || result === "timedOut") included.push({ source: s, split: splitAt(time(s.attemptedAt)) as DispatchSplit, outcome: result });
    else byReason[result]++;
  });
  included.sort((a, b) => time(a.source.attemptedAt) - time(b.source.attemptedAt) || compare(a.source.orderId, b.source.orderId)
    || compare(a.source.dispatchRoundId!, b.source.dispatchRoundId!) || compare(a.source.riderId, b.source.riderId));
  const groupKeys = new Map<string, string>();
  for (const { source } of included) if (!groupKeys.has(source.orderId)) groupKeys.set(source.orderId, `order-group-${String(groupKeys.size + 1).padStart(6, "0")}`);
  const rows: DispatchAcceptanceDatasetRow[] = included.map(({ source: s, split, outcome }, index) => {
    const local = new Date(time(s.attemptedAt) % (7 * 86_400_000) + options.timezoneOffsetMinutes * 60_000);
    return { schemaVersion: DISPATCH_DATASET_SCHEMA_VERSION, rowKey: `row-${String(index + 1).padStart(6, "0")}`,
      orderGroupKey: groupKeys.get(s.orderId)!, split, predictionPoint: "DISPATCH_PRE_OFFER",
      riderDistanceKm: s.riderDistanceKm!, activeWorkload: s.workloadAtDispatch!, hourOfDay: local.getUTCHours(), dayOfWeek: local.getUTCDay(), accepted: outcome === "accepted" };
  });
  const count = (outcome: string) => included.filter(x => x.outcome === outcome).length;
  return { rows, counts: { sourceCandidates: sources.length, offeredCandidates: sources.filter(s => s.assignmentId && !["CANDIDATE", "SKIPPED"].includes(s.status)).length,
    exportedRows: rows.length, acceptedRows: count("accepted"), declinedRows: count("declined"), timedOutRows: count("timedOut"),
    train: rows.filter(r => r.split === "train").length, validation: rows.filter(r => r.split === "validation").length, test: rows.filter(r => r.split === "test").length,
    uniqueOrderGroups: groupKeys.size, exclusionsByReason: byReason,
    rowsBySelectionPolicy: { DETERMINISTIC_FALLBACK: included.filter(x => x.source.selectionPolicy === "DETERMINISTIC_FALLBACK").length, ML_ASSISTED: included.filter(x => x.source.selectionPolicy === "ML_ASSISTED").length } } };
}
