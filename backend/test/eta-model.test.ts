import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CheckoutEtaModel } from "../src/ml/eta-model.js";
import type { CheckoutEtaFeatures } from "../src/ml/eta-features.js";

const artifact = JSON.parse(readFileSync(new URL("./fixtures/eta-model-artifact.synthetic.test.json", import.meta.url), "utf8"));
const parity: { modelVersion: string; absoluteTolerance: number; cases: { raw: CheckoutEtaFeatures; expectedPrediction: number }[] }
  = JSON.parse(readFileSync(new URL("../../ml/eta/fixtures/prediction-parity.json", import.meta.url), "utf8"));
const input = { distanceKm: 5, itemCount: 3, hourOfDay: 12, dayOfWeek: 1 };

describe("isolated checkout model", () => {
  it.each(parity.cases)("matches shared prediction fixture $expectedPrediction", ({ raw, expectedPrediction }) => {
    const result = new CheckoutEtaModel(artifact).predict(raw);
    expect(result.status).toBe("predicted");
    if (result.status !== "predicted") throw new Error("Expected fixture prediction");
    expect(Math.abs(result.predictedMinutes - expectedPrediction)).toBeLessThanOrEqual(parity.absoluteTolerance);
    expect(result.modelVersion).toBe(parity.modelVersion);
  });
  it("applies feature order, means, scales, coefficients and intercept without rounding", () => {
    expect(new CheckoutEtaModel(artifact).predict(input)).toEqual({ status: "predicted", predictedMinutes: 28.25, modelVersion: artifact.modelVersion });
  });
  it("preserves input/artifact and isolates itself from later artifact mutation", () => {
    const copy = structuredClone(artifact);
    const before = JSON.stringify(copy);
    const model = new CheckoutEtaModel(copy);
    const frozen = Object.freeze({ ...input });
    const prediction = model.predict(frozen);
    expect(model.predict(frozen)).toEqual(prediction);
    expect(JSON.stringify(copy)).toBe(before);
    copy.coefficients[0] = 999;
    expect(model.predict(frozen)).toEqual(prediction);
    expect(frozen).toEqual(input);
  });
  it.each([null, {}, { ...artifact, modelType: "other" }])("rejects invalid artifact %j", value => {
    expect(new CheckoutEtaModel(value).predict(input)).toEqual({ status: "unavailable", reason: "invalid_artifact" });
  });
  it.each([{ ...input, distanceKm: -1 }, { ...input, itemCount: 0 }, { ...input, hourOfDay: 24 }, { ...input, dayOfWeek: 7 }, { ...input, quotedEtaMinutes: 30 }])("rejects invalid features %j", value => {
    expect(new CheckoutEtaModel(artifact).predict(value)).toEqual({ status: "unavailable", reason: "invalid_features" });
  });
  it.each([0, -1])("rejects output %s without clipping/fallback", intercept => {
    expect(new CheckoutEtaModel({ ...artifact, coefficients: Array(10).fill(0), intercept }).predict(input))
      .toEqual({ status: "unavailable", reason: "invalid_prediction" });
  });
  it("rejects arithmetic overflow from finite model parameters", () => {
    const model = new CheckoutEtaModel({ ...artifact, coefficients: Array(10).fill(Number.MAX_VALUE) });
    expect(model.predict({ ...input, distanceKm: Number.MAX_VALUE })).toEqual({ status: "unavailable", reason: "invalid_prediction" });
  });
  it("enforces a caller limit with inclusive equality", () => {
    expect(new CheckoutEtaModel(artifact, { maxPredictionMinutes: 28.25 }).predict(input).status).toBe("predicted");
    expect(new CheckoutEtaModel(artifact, { maxPredictionMinutes: 28 }).predict(input))
      .toEqual({ status: "unavailable", reason: "prediction_exceeds_limit" });
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid limit %s", maxPredictionMinutes => {
    expect(new CheckoutEtaModel(artifact, { maxPredictionMinutes }).predict(input))
      .toEqual({ status: "unavailable", reason: "invalid_prediction_limit" });
  });
});
