import { describe, expect, it } from "vitest";
import { evaluateEta, type EtaObservation } from "../src/ml/metrics/eta-metrics.js";

function metricsFor(observations: readonly EtaObservation[]) {
  const result = evaluateEta(observations);
  expect(result.status).toBe("evaluated");
  if (result.status !== "evaluated") throw new Error("Expected evaluated fixture");
  return result;
}

describe("offline ETA metrics", () => {
  // Errors -20, -10, 0, 5, 15: early promise, exact promise, extra time.
  const observations = [0, 10, 20, 25, 35].map(predictedMinutes => ({ actualMinutes: 20, predictedMinutes }));

  it("calculates all required metrics with the documented signs and fractional rates", () => {
    const result = metricsFor(observations);
    expect(result.sampleCount).toBe(5);
    expect(result.excludedCount).toBe(0);
    expect(result.metrics.mae).toBeCloseTo(10);
    expect(result.metrics.medianAbsoluteError).toBe(10);
    expect(result.metrics.rmse).toBeCloseTo(Math.sqrt(150));
    expect(result.metrics.p90AbsoluteError).toBe(20);
    expect(result.metrics.meanSignedBias).toBeCloseTo(-2);
    expect(result.metrics.medianSignedLateness).toBeCloseTo(0);
    expect(result.metrics.p90SignedLateness).toBe(20);
    expect(result.metrics.p90LateMinutes).toBe(20);
    expect(result.metrics.within5MinutesRate).toBe(2 / 5);
    expect(result.metrics.within10MinutesRate).toBe(3 / 5);
    expect(result.metrics.within15MinutesRate).toBe(4 / 5);
    expect(result.metrics.overPromiseRate).toBe(2 / 5);
    expect(result.metrics.underPromiseRate).toBe(2 / 5);
    expect(result.metrics.withinPredictedEtaRate).toBe(3 / 5);
  });

  it("uses nearest-rank P90 rather than maximum or interpolation", () => {
    const result = metricsFor(Array.from({ length: 10 }, (_, i) => ({ actualMinutes: i + 1, predictedMinutes: 0 })));
    expect(result.metrics.p90AbsoluteError).toBe(9);
    expect(result.metrics.p90SignedLateness).toBe(9);
    expect(result.metrics.p90LateMinutes).toBe(9);
    expect(result.metrics.medianAbsoluteError).toBe(5.5);
    expect(result.metrics.medianSignedLateness).toBe(5.5);
  });

  it("distinguishes negative signed lateness from zero late minutes", () => {
    const { metrics } = metricsFor([{ actualMinutes: 10, predictedMinutes: 20 }, { actualMinutes: 10, predictedMinutes: 30 }]);
    expect(metrics.meanSignedBias).toBe(15);
    expect(metrics.medianSignedLateness).toBe(-15);
    expect(metrics.p90SignedLateness).toBe(-10);
    expect(metrics.p90LateMinutes).toBe(0);
    expect(metrics.underPromiseRate).toBe(1);
    expect(metrics.overPromiseRate).toBe(0);
  });

  it("handles exact predictions including zero error scale", () => {
    const { metrics } = metricsFor([{ actualMinutes: 10, predictedMinutes: 10 }]);
    expect(metrics.mae).toBe(0);
    expect(metrics.rmse).toBe(0);
    expect(metrics.meanSignedBias).toBe(0);
    expect(metrics.overPromiseRate).toBe(0);
    expect(metrics.underPromiseRate).toBe(0);
    expect(metrics.withinPredictedEtaRate).toBe(1);
  });

  it("returns explicit unavailability for empty input", () => {
    expect(evaluateEta([])).toEqual({ status: "unavailable", reason: "no_valid_observations", sampleCount: 0, excludedCount: 0 });
  });

  it.each([0, -1, NaN, Infinity, -Infinity, "10", null, undefined])("counts invalid actual duration %s", actualMinutes => {
    const result = metricsFor([...observations, { actualMinutes, predictedMinutes: 10 } as EtaObservation]);
    expect(result.sampleCount).toBe(5);
    expect(result.excludedCount).toBe(1);
    expect(result.metrics).toEqual(metricsFor(observations).metrics);
  });

  it.each([-1, NaN, Infinity, -Infinity, "10", null, undefined])("counts invalid prediction %s", predictedMinutes => {
    const result = metricsFor([...observations, { actualMinutes: 10, predictedMinutes } as EtaObservation]);
    expect(result.sampleCount).toBe(5);
    expect(result.excludedCount).toBe(1);
  });

  it("reports all-invalid input without fabricated metrics", () => {
    expect(evaluateEta([{ actualMinutes: 0, predictedMinutes: 0 }])).toEqual({
      status: "unavailable", reason: "no_valid_observations", sampleCount: 0, excludedCount: 1,
    });
  });

  it("keeps every metric finite even when naive sums and squares would overflow", () => {
    const { metrics } = metricsFor([
      { actualMinutes: Number.MAX_VALUE, predictedMinutes: 0 },
      { actualMinutes: Number.MAX_VALUE, predictedMinutes: 0 },
    ]);
    expect(Object.values(metrics).every(Number.isFinite)).toBe(true);
    expect(metrics.mae).toBe(Number.MAX_VALUE);
    expect(metrics.rmse).toBe(Number.MAX_VALUE);
    expect(metrics.medianSignedLateness).toBe(Number.MAX_VALUE);
  });

  it("does not mutate caller data and is repeatable", () => {
    const input = Object.freeze(observations.map(row => Object.freeze({ ...row })));
    expect(evaluateEta(input)).toEqual(evaluateEta(input));
    expect(input).toEqual(observations);
  });
});
