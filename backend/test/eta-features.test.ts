import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeCheckoutFeatures, ETA_FEATURE_CONTRACT_VERSION, ETA_ORDERED_FEATURES } from "../src/ml/eta-features.js";

const fixture: { featureContractVersion: string; absoluteTolerance: number; cases: { name: string; raw: unknown; expected: number[] }[] }
  = JSON.parse(readFileSync(new URL("../../ml/eta/fixtures/feature-parity.json", import.meta.url), "utf8"));
const contract = JSON.parse(readFileSync(new URL("../../ml/eta/feature-contract.json", import.meta.url), "utf8"));
const raw = { distanceKm: 5, itemCount: 2, hourOfDay: 12, dayOfWeek: 1 };
describe("checkout feature contract", () => {
  it("matches the shared contract version and exact ten-feature order", () => {
    expect(ETA_FEATURE_CONTRACT_VERSION).toBe("eta-checkout-features-v1");
    expect(contract.featureContractVersion).toBe(ETA_FEATURE_CONTRACT_VERSION);
    expect(fixture.featureContractVersion).toBe(ETA_FEATURE_CONTRACT_VERSION);
    expect(ETA_ORDERED_FEATURES).toEqual(["distanceKm", "itemCount", "hourSin", "hourCos", "isMonday", "isTuesday", "isWednesday", "isThursday", "isFriday", "isSaturday"]);
    expect(contract.orderedFeatures).toEqual(ETA_ORDERED_FEATURES);
    expect(Object.keys(contract.rawInputs).sort()).toEqual(Object.keys(raw).sort());
    expect(contract.additionalRawInputs).toBe(false);
    expect(contract.rawInputs.dayOfWeek.sunday).toBe(0);
  });
  it.each(fixture.cases)("matches shared fixture $name", ({ raw, expected }: { raw: unknown; expected: number[] }) => {
    const result = encodeCheckoutFeatures(raw);
    expect(result.status).toBe("encoded");
    if (result.status !== "encoded") throw new Error("Invalid fixture");
    expect(result.features).toHaveLength(10);
    result.features.forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(fixture.absoluteTolerance));
  });
  it.each([
    ["distanceKm", -1], ["distanceKm", NaN], ["distanceKm", Infinity], ["distanceKm", -Infinity], ["distanceKm", "5"],
    ["itemCount", 0], ["itemCount", -1], ["itemCount", 1.5], ["itemCount", true], ["itemCount", Infinity],
    ["hourOfDay", -1], ["hourOfDay", 24], ["hourOfDay", 1.5], ["hourOfDay", null],
    ["dayOfWeek", -1], ["dayOfWeek", 7], ["dayOfWeek", 1.5], ["dayOfWeek", "1"],
  ])("rejects %s=%s without coercion", (key, value) => {
    expect(encodeCheckoutFeatures({ ...raw, [key]: value }).status).toBe("unavailable");
  });
  it.each(["quotedEtaMinutes", "distanceBaselineMinutes", "actualDurationMinutes", "split", "orderId", "workload", "batched"])("rejects forbidden extra %s", key => {
    expect(encodeCheckoutFeatures({ ...raw, [key]: 1 })).toEqual({ status: "unavailable", reason: "invalid_shape" });
  });
  it.each([null, [], {}, { distanceKm: 1 }])("rejects missing/invalid shape %j", value => {
    expect(encodeCheckoutFeatures(value).status).toBe("unavailable");
  });
  it("is deterministic and does not mutate frozen input", () => {
    const input = Object.freeze({ ...raw });
    expect(encodeCheckoutFeatures(input)).toEqual(encodeCheckoutFeatures(input));
    expect(input).toEqual(raw);
  });
});
