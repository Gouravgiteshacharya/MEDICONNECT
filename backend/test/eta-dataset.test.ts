import { afterEach, describe, expect, it, vi } from "vitest";
import * as baseline from "../src/ml/eta-baseline.js";
import { extractEtaDataset } from "../src/ml/dataset/eta-dataset.extractor.js";
import {
  ETA_DATASET_SCHEMA_VERSION, type EtaDatasetOptions, type EtaDatasetSourceRecord,
  type EtaDatasetExclusionReason,
} from "../src/ml/dataset/eta-dataset.types.js";

const options: EtaDatasetOptions = {
  fallbackSpeedKmh: 20, timezoneOffsetMinutes: 330,
  trainStart: new Date("2026-01-01Z"), validationStart: new Date("2026-02-01Z"),
  testStart: new Date("2026-03-01Z"), testEnd: new Date("2026-04-01Z"),
  outcomeCutoff: new Date("2026-04-02Z"),
};
function source(overrides: Partial<EtaDatasetSourceRecord> = {}): EtaDatasetSourceRecord {
  return {
    orderId: "internal-order", fulfillmentMethod: "DELIVERY", orderStatus: "DELIVERED",
    placedAt: new Date("2026-01-03T20:00:00Z"), completedAt: new Date("2026-01-03T20:30:30Z"),
    distanceKm: 5, quotedEtaMinutes: 20, itemCount: 2,
    assignments: [{ status: "DELIVERED", deliveredAt: new Date("2026-01-03T20:30:30Z") }],
    ...overrides,
  };
}
function at(placed: string): EtaDatasetSourceRecord {
  const placedAt = new Date(placed);
  const deliveredAt = new Date(placedAt.getTime() + 60_000);
  return source({ placedAt, completedAt: deliveredAt, assignments: [{ status: "DELIVERED", deliveredAt }] });
}
function excluded(record: EtaDatasetSourceRecord, reason: EtaDatasetExclusionReason, config = options) {
  const result = extractEtaDataset([record], config);
  expect(result.rows).toEqual([]);
  expect(result.exclusions.totalExcluded).toBe(1);
  expect(result.exclusions.byReason[reason]).toBe(1);
  expect(Object.values(result.exclusions.byReason).reduce((a, b) => a + b, 0)).toBe(1);
}

afterEach(() => vi.restoreAllMocks());

describe("pure checkout dataset transformer", () => {
  it("includes an eligible order with exact schema, fractional label and Sunday=0 fixed-offset features", () => {
    const result = extractEtaDataset([source()], options);
    expect(ETA_DATASET_SCHEMA_VERSION).toBe("eta-checkout-v1");
    expect(result.rows).toEqual([{
      schemaVersion: "eta-checkout-v1", rowKey: "row-000001", predictionPoint: "CHECKOUT", split: "train",
      distanceKm: 5, itemCount: 2, hourOfDay: 1, dayOfWeek: 0,
      quotedEtaMinutes: 20, distanceBaselineMinutes: 15, actualDurationMinutes: 30.5,
    }]);
    expect(result.exclusions.totalExcluded).toBe(0);
  });

  it.each<[Partial<EtaDatasetSourceRecord>, EtaDatasetExclusionReason]>([
    [{ fulfillmentMethod: "SELF_PICKUP" }, "not_delivery"],
    [{ orderStatus: "CANCELLED" }, "not_delivered"],
    [{ orderStatus: "REJECTED" }, "not_delivered"],
    [{ placedAt: new Date(NaN) }, "invalid_placed_at"],
    [{ completedAt: null }, "missing_completed_at"],
    [{ completedAt: new Date(NaN) }, "invalid_completed_at"],
    [{ assignments: [] }, "no_delivered_assignment"],
    [{ assignments: [{ status: "FAILED", deliveredAt: new Date("2026-01-03T20:30:30Z") }] }, "no_delivered_assignment"],
    [{ assignments: [{ status: "DELIVERED", deliveredAt: null }] }, "invalid_delivered_at"],
    [{ assignments: [{ status: "DELIVERED", deliveredAt: new Date(NaN) }] }, "invalid_delivered_at"],
    [{ completedAt: new Date("2026-01-03T20:30:30.001Z") }, "completion_timestamp_mismatch"],
  ])("excludes invalid source %j as %s", (overrides, reason) => excluded(source(overrides), reason));

  it("quarantines multiple successful assignments rather than choosing a timestamp", () => {
    excluded(source({ assignments: [...source().assignments, { status: "DELIVERED", deliveredAt: null }] }), "multiple_delivered_assignments");
  });
  it("allows earlier failed assignments alongside exactly one successful assignment", () => {
    expect(extractEtaDataset([source({ assignments: [{ status: "FAILED", deliveredAt: null }, ...source().assignments] })], options).rows).toHaveLength(1);
  });
  it.each([0, -60_000])("excludes nonpositive duration %s", delta => {
    const record = source();
    const deliveredAt = new Date(record.placedAt.getTime() + delta);
    excluded(source({ completedAt: deliveredAt, assignments: [{ status: "DELIVERED", deliveredAt }] }), "nonpositive_actual_duration");
  });
  it.each([null, -1, NaN, Infinity, -Infinity, "5", undefined])("rejects invalid distance %s", value => {
    excluded(source({ distanceKm: value as number }), "invalid_distance");
  });
  it.each([0, -1, 1.5, NaN, Infinity, "2", null])("rejects invalid item count %s", value => {
    excluded(source({ itemCount: value as number }), "invalid_item_count");
  });
  it.each([-1, 1.5, NaN, Infinity, "20", undefined])("rejects invalid quoted ETA %s", value => {
    excluded(source({ quotedEtaMinutes: value as number }), "invalid_quoted_eta");
  });
  it.each([null, 0])("accepts quoted ETA %s and zero distance", quotedEtaMinutes => {
    const row = extractEtaDataset([source({ distanceKm: 0, quotedEtaMinutes })], options).rows[0];
    expect(row.distanceBaselineMinutes).toBe(0);
    expect(row.quotedEtaMinutes).toBe(quotedEtaMinutes);
  });
  it("calls the Phase 2 predictor with only distance and explicit speed and uses its result", () => {
    const spy = vi.spyOn(baseline, "predictEtaBaseline").mockReturnValue({ status: "predicted", predictedMinutes: 123, source: "distance_speed_baseline" });
    expect(extractEtaDataset([source()], options).rows[0].distanceBaselineMinutes).toBe(123);
    expect(spy).toHaveBeenCalledExactlyOnceWith({ distanceKm: 5, fallbackSpeedKmh: 20 });
  });
  it("uses custom speed", () => {
    expect(extractEtaDataset([source()], { ...options, fallbackSpeedKmh: 30 }).rows[0].distanceBaselineMinutes).toBe(10);
  });
  it.each([0, NaN, Number.MIN_VALUE])("counts unavailable baseline with speed %s", fallbackSpeedKmh => {
    excluded(source(), "baseline_unavailable", { ...options, fallbackSpeedKmh });
  });
  it("handles a negative timezone offset across the previous day", () => {
    const row = extractEtaDataset([at("2026-01-04T01:00:00Z")], { ...options, timezoneOffsetMinutes: -120 }).rows[0];
    expect(row.hourOfDay).toBe(23);
    expect(row.dayOfWeek).toBe(6);
  });
  it.each([
    ["2026-01-01T00:00:00Z", "train"],
    ["2026-01-31T23:59:59.999Z", "train"],
    ["2026-02-01T00:00:00Z", "validation"],
    ["2026-02-28T23:59:59.999Z", "validation"],
    ["2026-03-01T00:00:00Z", "test"],
    ["2026-03-31T23:59:59.999Z", "test"],
  ])("assigns %s to %s using UTC boundaries", (date, split) => {
    expect(extractEtaDataset([at(date)], options).rows[0].split).toBe(split);
  });
  it.each(["2025-12-31T23:59:59.999Z", "2026-04-01T00:00:00Z"])("excludes outside window %s", date => {
    excluded(at(date), "outside_split_window");
  });
  it("excludes outcomes after the cutoff and accepts equality", () => {
    const record = source();
    const cutoff = record.completedAt!;
    expect(extractEtaDataset([record], { ...options, outcomeCutoff: cutoff }).rows).toHaveLength(1);
    excluded(record, "outcome_not_mature", { ...options, outcomeCutoff: new Date(cutoff.getTime() - 1) });
  });
  it("excludes every duplicate before any other validation or split assignment", () => {
    const result = extractEtaDataset([source(), source({ orderStatus: "CANCELLED" }), { ...at("2026-03-01Z"), orderId: "internal-order" }], options);
    expect(result.rows).toEqual([]);
    expect(result.exclusions.totalExcluded).toBe(3);
    expect(result.exclusions.byReason.duplicate_order).toBe(3);
    expect(result.exclusions.byReason.not_delivered).toBe(0);
  });
  it("sorts eligible records by placement then code-unit order ID before assigning stable keys", () => {
    const records = [source({ orderId: "z", itemCount: 3 }), source({ orderId: "a", itemCount: 2 }), { ...at("2026-01-02Z"), orderId: "early", itemCount: 1 }, source({ orderId: "excluded", orderStatus: "CANCELLED" })];
    const result = extractEtaDataset(records, options);
    expect(result.rows.map(row => row.itemCount)).toEqual([1, 2, 3]);
    expect(result.rows.map(row => row.rowKey)).toEqual(["row-000001", "row-000002", "row-000003"]);
    expect(JSON.stringify(result)).toBe(JSON.stringify(extractEtaDataset([...records].reverse(), options)));
  });
  it("exports only allowlisted keys even if runtime sources carry additional private fields", () => {
    const privateRecord = { ...source(), orderNumber: "secret-number", customerId: "secret-customer", riderId: "secret-rider", pharmacyId: "secret-pharmacy", latitude: 123, longitude: 456, address: "secret-address", phone: "secret-phone", prescription: "secret-file", amount: 987 };
    const rows = extractEtaDataset([privateRecord], options).rows;
    expect(Object.keys(rows[0]).sort()).toEqual(["schemaVersion", "rowKey", "predictionPoint", "split", "distanceKm", "itemCount", "hourOfDay", "dayOfWeek", "quotedEtaMinutes", "distanceBaselineMinutes", "actualDurationMinutes"].sort());
    const serialized = JSON.stringify(rows);
    for (const forbidden of ["orderId", "orderNumber", "customerId", "riderId", "pharmacyId", "latitude", "longitude", "address", "phone", "prescription", "amount", "placedAt", "deliveredAt", "completedAt", "internal-order", "secret-", "2026-"]) expect(serialized).not.toContain(forbidden);
  });
  it("preserves frozen inputs, assignments and date values and repeats byte-for-byte", () => {
    const record = source();
    Object.freeze(record.assignments[0]); Object.freeze(record.assignments);
    Object.freeze(record.placedAt); Object.freeze(record.completedAt); Object.freeze(record);
    const records = Object.freeze([record]);
    const before = JSON.stringify(records);
    const configBefore = JSON.stringify(options);
    const result = extractEtaDataset(records, Object.freeze({ ...options }));
    expect(JSON.stringify(extractEtaDataset(records, options))).toBe(JSON.stringify(result));
    expect(JSON.stringify(records)).toBe(before);
    expect(JSON.stringify(options)).toBe(configBefore);
  });
  it("counts every exclusion once with deterministic precedence and reconciling totals", () => {
    const records = [source({ orderId: "a", fulfillmentMethod: "SELF_PICKUP", orderStatus: "CANCELLED" }), source({ orderId: "b", placedAt: new Date(NaN), distanceKm: -1 }), source({ orderId: "c", distanceKm: -1, itemCount: 0 }), source({ orderId: "d" })];
    const result = extractEtaDataset(records, options);
    expect(result.exclusions.byReason.not_delivery).toBe(1);
    expect(result.exclusions.byReason.invalid_placed_at).toBe(1);
    expect(result.exclusions.byReason.invalid_distance).toBe(1);
    expect(result.exclusions.totalExcluded).toBe(3);
    expect(Object.values(result.exclusions.byReason).reduce((a, b) => a + b, 0)).toBe(3);
    expect(result.rows.length + result.exclusions.totalExcluded).toBe(records.length);
  });
  it("returns a stable empty result with all zero reason counts", () => {
    const result = extractEtaDataset([], options);
    expect(result.rows).toEqual([]);
    expect(result.exclusions.totalExcluded).toBe(0);
    expect(Object.values(result.exclusions.byReason).every(count => count === 0)).toBe(true);
  });
  it.each<Partial<EtaDatasetOptions>>([
    { trainStart: new Date(NaN) }, { validationStart: options.trainStart },
    { testStart: options.trainStart }, { testEnd: options.testStart }, { outcomeCutoff: new Date(NaN) },
    { timezoneOffsetMinutes: NaN }, { timezoneOffsetMinutes: 1.5 },
    { timezoneOffsetMinutes: -721 }, { timezoneOffsetMinutes: 841 },
  ])("rejects invalid explicit configuration %j", overrides => {
    expect(() => extractEtaDataset([], { ...options, ...overrides })).toThrow(RangeError);
  });
});
