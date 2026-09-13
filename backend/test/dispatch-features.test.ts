import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeDispatchFeatures, DISPATCH_FEATURE_CONTRACT_VERSION, DISPATCH_ORDERED_FEATURES } from "../src/ml/dispatch-features.js";

const fixture: { featureContractVersion: string; tolerance: number; cases: { name: string; raw: unknown; encoded: number[] }[] }
  = JSON.parse(readFileSync(new URL("../../ml/dispatch/fixtures/feature-parity.json", import.meta.url), "utf8"));
const contract = JSON.parse(readFileSync(new URL("../../ml/dispatch/feature-contract.json", import.meta.url), "utf8"));
const raw = { riderDistanceKm: 5, activeWorkload: 2, hourOfDay: 12, dayOfWeek: 1 };
describe("dispatch acceptance feature contract", () => {
  it("matches the shared contract version and exact ten-feature order", () => {
    expect(DISPATCH_FEATURE_CONTRACT_VERSION).toBe("dispatch-acceptance-features-v1");
    expect(contract.featureContractVersion).toBe(DISPATCH_FEATURE_CONTRACT_VERSION);
    expect(fixture.featureContractVersion).toBe(DISPATCH_FEATURE_CONTRACT_VERSION);
    expect(DISPATCH_ORDERED_FEATURES).toEqual(["riderDistanceKm", "activeWorkload", "hourSin", "hourCos", "isMonday", "isTuesday", "isWednesday", "isThursday", "isFriday", "isSaturday"]);
    expect(contract.orderedFeatures).toEqual(DISPATCH_ORDERED_FEATURES);
    expect(Object.keys(contract.rawFeatures).sort()).toEqual(Object.keys(raw).sort());
    expect(contract.extraFields).toBe("reject");
    expect(contract.weekdayReference).toBe("Sunday");
  });
  it.each(fixture.cases)("matches shared fixture $name", ({ raw, encoded }: { raw: unknown; encoded: number[] }) => {
    const result = encodeDispatchFeatures(raw);
    expect(result.status).toBe("encoded");
    if (result.status !== "encoded") throw new Error("Invalid fixture");
    expect(result.features).toHaveLength(10);
    result.features.forEach((value, index) => expect(Math.abs(value - encoded[index])).toBeLessThanOrEqual(fixture.tolerance));
  });
  it.each([
    ["riderDistanceKm", -1], ["riderDistanceKm", NaN], ["riderDistanceKm", Infinity], ["riderDistanceKm", -Infinity], ["riderDistanceKm", "5"],
    ["activeWorkload", -1], ["activeWorkload", 1.5], ["activeWorkload", true], ["activeWorkload", Infinity],
    ["hourOfDay", -1], ["hourOfDay", 24], ["hourOfDay", 1.5], ["hourOfDay", null],
    ["dayOfWeek", -1], ["dayOfWeek", 7], ["dayOfWeek", 1.5], ["dayOfWeek", "1"],
  ])("rejects %s=%s without coercion", (key, value) => {
    expect(encodeDispatchFeatures({ ...raw, [key]: value }).status).toBe("unavailable");
  });
  it.each(["accepted", "rank", "selectionPolicy", "split", "orderId", "riderId", "batched"])("rejects forbidden extra %s", key => {
    expect(encodeDispatchFeatures({ ...raw, [key]: 1 })).toEqual({ status: "unavailable", reason: "invalid_shape" });
  });
  it.each([null, [], {}, { riderDistanceKm: 1 }])("rejects missing/invalid shape %j", value => {
    expect(encodeDispatchFeatures(value).status).toBe("unavailable");
  });
  it("accepts zero distance and workload with Sunday reference", () => {
    expect(encodeDispatchFeatures({ riderDistanceKm: 0, activeWorkload: 0, hourOfDay: 0, dayOfWeek: 0 })).toEqual({ status: "encoded", features: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0] });
  });
  it("is deterministic and does not mutate frozen input", () => {
    const input = Object.freeze({ ...raw });
    expect(encodeDispatchFeatures(input)).toEqual(encodeDispatchFeatures(input));
    expect(input).toEqual(raw);
  });
});
