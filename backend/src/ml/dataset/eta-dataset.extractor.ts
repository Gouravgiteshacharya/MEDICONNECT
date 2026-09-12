import { predictEtaBaseline } from "../eta-baseline.js";
import {
  ETA_DATASET_EXCLUSION_REASONS, ETA_DATASET_SCHEMA_VERSION,
  type EtaDatasetExclusionReason, type EtaDatasetOptions, type EtaDatasetResult,
  type EtaDatasetRow, type EtaDatasetSourceRecord,
} from "./eta-dataset.types.js";

function timestamp(value: Date | null): number {
  return value instanceof Date ? value.getTime() : NaN;
}

/**
 * Pure transformation of already-loaded records; no I/O or ambient configuration.
 * Primary exclusion precedence follows ETA_DATASET_EXCLUSION_REASONS in order.
 * Invalid window/offset configuration throws a fixed RangeError before processing.
 * Invalid speed is handled by the baseline as a per-row baseline_unavailable result.
 */
export function extractEtaDataset(
  sources: readonly EtaDatasetSourceRecord[], options: EtaDatasetOptions,
): EtaDatasetResult {
  const trainStart = timestamp(options.trainStart);
  const validationStart = timestamp(options.validationStart);
  const testStart = timestamp(options.testStart);
  const testEnd = timestamp(options.testEnd);
  const cutoff = timestamp(options.outcomeCutoff);
  if (![trainStart, validationStart, testStart, testEnd, cutoff].every(Number.isFinite)
    || !(trainStart < validationStart && validationStart < testStart && testStart < testEnd)) {
    throw new RangeError("Dataset boundaries must be valid, strictly increasing UTC instants with a valid outcome cutoff");
  }
  if (!Number.isInteger(options.timezoneOffsetMinutes)
    || options.timezoneOffsetMinutes < -720 || options.timezoneOffsetMinutes > 840) {
    throw new RangeError("Dataset timezone offset must be an integer between -720 and 840 minutes");
  }

  const counts = new Map<string, number>();
  for (const source of sources) counts.set(source.orderId, (counts.get(source.orderId) ?? 0) + 1);
  const byReason = Object.fromEntries(
    ETA_DATASET_EXCLUSION_REASONS.map(reason => [reason, 0]),
  ) as Record<EtaDatasetExclusionReason, number>;
  const included: { placedAt: number; orderId: string; row: Omit<EtaDatasetRow, "rowKey"> }[] = [];
  let totalExcluded = 0;

  function transform(source: EtaDatasetSourceRecord): EtaDatasetExclusionReason | null {
    if (counts.get(source.orderId)! > 1) return "duplicate_order";
    if (source.fulfillmentMethod !== "DELIVERY") return "not_delivery";
    if (source.orderStatus !== "DELIVERED") return "not_delivered";
    const placedAt = timestamp(source.placedAt);
    if (!Number.isFinite(placedAt)) return "invalid_placed_at";
    if (placedAt < trainStart || placedAt >= testEnd) return "outside_split_window";
    const split = placedAt < validationStart ? "train" : placedAt < testStart ? "validation" : "test";
    const successful = source.assignments.filter(assignment => assignment.status === "DELIVERED");
    if (successful.length === 0) return "no_delivered_assignment";
    if (successful.length > 1) return "multiple_delivered_assignments";
    const deliveredAt = timestamp(successful[0].deliveredAt);
    if (!Number.isFinite(deliveredAt)) return "invalid_delivered_at";
    if (source.completedAt === null) return "missing_completed_at";
    const completedAt = timestamp(source.completedAt);
    if (!Number.isFinite(completedAt)) return "invalid_completed_at";
    if (completedAt !== deliveredAt) return "completion_timestamp_mismatch";
    if (deliveredAt > cutoff) return "outcome_not_mature";
    const actualDurationMinutes = (deliveredAt - placedAt) / 60_000;
    if (!Number.isFinite(actualDurationMinutes) || actualDurationMinutes <= 0) return "nonpositive_actual_duration";
    if (source.distanceKm === null || !Number.isFinite(source.distanceKm) || source.distanceKm < 0) return "invalid_distance";
    if (!Number.isInteger(source.itemCount) || source.itemCount <= 0) return "invalid_item_count";
    if (source.quotedEtaMinutes !== null
      && (!Number.isInteger(source.quotedEtaMinutes) || source.quotedEtaMinutes < 0)) return "invalid_quoted_eta";
    const baseline = predictEtaBaseline({ distanceKm: source.distanceKm, fallbackSpeedKmh: options.fallbackSpeedKmh });
    if (baseline.status === "unavailable") return "baseline_unavailable";
    // Whole-week reduction preserves UTC weekday/hour and avoids Date overflow at range edges.
    const localTime = new Date(placedAt % (7 * 86_400_000) + options.timezoneOffsetMinutes * 60_000);
    included.push({ placedAt, orderId: source.orderId, row: {
      schemaVersion: ETA_DATASET_SCHEMA_VERSION,
      predictionPoint: "CHECKOUT", split,
      distanceKm: source.distanceKm, itemCount: source.itemCount,
      hourOfDay: localTime.getUTCHours(), dayOfWeek: localTime.getUTCDay(),
      quotedEtaMinutes: source.quotedEtaMinutes,
      distanceBaselineMinutes: baseline.predictedMinutes, actualDurationMinutes,
    } });
    return null;
  }

  for (const source of sources) {
    const reason = transform(source);
    if (reason !== null) { byReason[reason]++; totalExcluded++; }
  }
  // Code-unit comparison avoids locale-dependent order-ID collation.
  included.sort((a, b) => a.placedAt - b.placedAt || (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0));
  const rows = included.map(({ row }, index): EtaDatasetRow => ({
    schemaVersion: row.schemaVersion, rowKey: `row-${String(index + 1).padStart(6, "0")}`,
    predictionPoint: row.predictionPoint, split: row.split,
    distanceKm: row.distanceKm, itemCount: row.itemCount,
    hourOfDay: row.hourOfDay, dayOfWeek: row.dayOfWeek,
    quotedEtaMinutes: row.quotedEtaMinutes, distanceBaselineMinutes: row.distanceBaselineMinutes,
    actualDurationMinutes: row.actualDurationMinutes,
  }));
  return { rows, exclusions: { totalExcluded, byReason } };
}
