export const ETA_DATASET_SCHEMA_VERSION = "eta-checkout-v1" as const;

export interface EtaDatasetRow {
  readonly schemaVersion: typeof ETA_DATASET_SCHEMA_VERSION;
  readonly rowKey: string;
  readonly predictionPoint: "CHECKOUT";
  readonly split: "train" | "validation" | "test";
  readonly distanceKm: number;
  readonly itemCount: number;
  readonly hourOfDay: number;
  /** Sunday = 0, using the configured fixed UTC offset. */
  readonly dayOfWeek: number;
  readonly quotedEtaMinutes: number | null;
  readonly distanceBaselineMinutes: number;
  readonly actualDurationMinutes: number;
}

/** Internal loading boundary only. Never serialize source records as dataset rows. */
export interface EtaDatasetSourceRecord {
  readonly orderId: string;
  readonly fulfillmentMethod: string;
  readonly orderStatus: string;
  readonly placedAt: Date;
  readonly completedAt: Date | null;
  readonly distanceKm: number | null;
  readonly quotedEtaMinutes: number | null;
  /** Number of order-item lines, not the sum of quantities. */
  readonly itemCount: number;
  readonly assignments: readonly {
    readonly status: string;
    readonly deliveredAt: Date | null;
  }[];
}

export interface EtaDatasetOptions {
  readonly fallbackSpeedKmh: number;
  readonly timezoneOffsetMinutes: number;
  readonly trainStart: Date;
  readonly validationStart: Date;
  readonly testStart: Date;
  readonly testEnd: Date;
  readonly outcomeCutoff: Date;
}

export const ETA_DATASET_EXCLUSION_REASONS = [
  "duplicate_order", "not_delivery", "not_delivered", "invalid_placed_at",
  "outside_split_window", "no_delivered_assignment", "multiple_delivered_assignments",
  "invalid_delivered_at", "missing_completed_at", "invalid_completed_at",
  "completion_timestamp_mismatch", "outcome_not_mature", "nonpositive_actual_duration",
  "invalid_distance", "invalid_item_count", "invalid_quoted_eta", "baseline_unavailable",
] as const;

export type EtaDatasetExclusionReason = typeof ETA_DATASET_EXCLUSION_REASONS[number];

export interface EtaDatasetResult {
  readonly rows: readonly EtaDatasetRow[];
  readonly exclusions: {
    readonly totalExcluded: number;
    readonly byReason: Readonly<Record<EtaDatasetExclusionReason, number>>;
  };
}
