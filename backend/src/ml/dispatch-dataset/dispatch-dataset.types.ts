export const DISPATCH_DATASET_SCHEMA_VERSION = "dispatch-acceptance-v1" as const;
export const DISPATCH_EXCLUSION_REASONS = [
  "duplicate_offer_mapping", "missing_round_id", "instrumentation_incomplete", "unoffered_candidate",
  "missing_assignment", "invalid_offer_mapping", "invalid_policy", "invalid_attempted_at", "invalid_assigned_at",
  "outside_split_window", "cross_split_order_group", "missing_offer_deadline", "invalid_offer_deadline",
  "invalid_distance", "invalid_workload", "outcome_not_mature", "conflicting_outcome",
  "administrative_outcome_ambiguous", "invalid_acceptance", "invalid_decline", "invalid_timeout",
] as const;
export type DispatchExclusionReason = typeof DISPATCH_EXCLUSION_REASONS[number];
export type DispatchSplit = "train" | "validation" | "test";
export interface DispatchAcceptanceDatasetRow {
  readonly schemaVersion: typeof DISPATCH_DATASET_SCHEMA_VERSION;
  readonly rowKey: string; readonly orderGroupKey: string; readonly split: DispatchSplit;
  readonly predictionPoint: "DISPATCH_PRE_OFFER";
  readonly riderDistanceKm: number; readonly activeWorkload: number;
  readonly hourOfDay: number; readonly dayOfWeek: number; readonly accepted: boolean;
}
export interface DispatchDatasetOptions {
  readonly trainStart: Date; readonly validationStart: Date; readonly testStart: Date; readonly testEnd: Date;
  readonly outcomeCutoff: Date; readonly timezoneOffsetMinutes: number;
}
/** Internal-only join keys and decision history. Never serialize this record. */
export interface DispatchDatasetSource {
  readonly candidateId: string; readonly orderId: string; readonly riderId: string;
  readonly dispatchRoundId: string | null; readonly assignmentId: string | null;
  readonly status: string; readonly attemptedAt: Date;
  readonly riderDistanceKm: number | null; readonly workloadAtDispatch: number | null;
  readonly deterministicRank: number | null; readonly dispatchPolicyVersion: string | null;
  readonly selectionPolicy: string | null; readonly workloadPenaltyKm: number | null;
  readonly shortlistSize: number | null; readonly searchRadiusKm: number | null; readonly freshnessThresholdMs: number | null;
  readonly orderStatus: string; readonly orderCancelledAt: Date | null;
  readonly assignment: null | {
    readonly id: string; readonly orderId: string; readonly riderId: string; readonly assignedAt: Date;
    readonly offerExpiresAt: Date | null; readonly status: string; readonly acceptedAt: Date | null;
    readonly declinedAt: Date | null; readonly timedOutAt: Date | null;
    readonly cancelledAt: Date | null; readonly reassignedAt: Date | null;
  };
}
