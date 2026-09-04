import { describe, expect, it } from "vitest";
import { isPeakHour, type LogisticsModel } from "../src/ml/logistics-model.js";
import { loadMlConfig } from "../src/ml/ml.config.js";

describe("logistics model integration", () => {
  it("accepts an Intelligence-owned predictor through the Delivery interface", () => { const model: LogisticsModel = { predictDispatch: () => ({ predictedCompletionMinutes: 24, modelVersion: "intelligence-test" }), predictEta: () => ({ predictedCompletionMinutes: 29, modelVersion: "intelligence-test" }) }; expect(model.predictDispatch({ riderDistanceKm: 2, workload: 1, customerDistanceKm: 5, peakHour: 1, batched: 0 })).toEqual({ predictedCompletionMinutes: 24, modelVersion: "intelligence-test" }); });
  it("derives peak hours using the configured operational timezone", () => { expect(isPeakHour(new Date("2026-08-31T03:00:00Z"), 330)).toBe(1); expect(isPeakHour(new Date("2026-08-31T05:30:00Z"), 330)).toBe(0); expect(isPeakHour(new Date("2026-08-31T12:30:00Z"), 330)).toBe(1); });
  it("validates enablement and prediction guardrails", () => { expect(loadMlConfig({ ML_LOGISTICS_ENABLED: "false" }).enabled).toBe(false); expect(() => loadMlConfig({ ML_LOGISTICS_ENABLED: "yes" })).toThrow(); expect(() => loadMlConfig({ ML_MAX_PREDICTION_MINUTES: "0" })).toThrow(); expect(() => loadMlConfig({ ML_FALLBACK_SPEED_KMH: "NaN" })).toThrow(); expect(() => loadMlConfig({ ML_TIMEZONE_OFFSET_MINUTES: "900" })).toThrow(); });
});
