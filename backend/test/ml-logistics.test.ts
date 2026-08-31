import { describe, expect, it } from "vitest";
import { SyntheticLinearLogisticsModel, SYNTHETIC_MODEL_METADATA, isPeakHour } from "../src/ml/logistics-model.js";
import { loadMlConfig } from "../src/ml/ml.config.js";

describe("synthetic logistics model", () => {
  it("publishes honest reproducibility and holdout-evaluation metadata", () => { expect(SYNTHETIC_MODEL_METADATA).toMatchObject({ trainingSource: "SYNTHETIC", seed: 20260831, samples: 5000, trainSamples: 4000, testSamples: 1000, metrics: { maeMinutes: 3.192645131197737, r2: 0.9622407770659755 } }); });
  it("produces deterministic explainable completion predictions", () => { const prediction = new SyntheticLinearLogisticsModel().predictDispatch({ riderDistanceKm: 2, workload: 1, customerDistanceKm: 5, peakHour: 1, batched: 0 }); expect(prediction.modelVersion).toBe("synthetic-linear-v1"); expect(prediction.predictedCompletionMinutes).toBeCloseTo(40.47, 1); });
  it("rejects out-of-distribution and non-finite inputs so callers can fall back", () => { const model = new SyntheticLinearLogisticsModel(); expect(() => model.predictEta({ riderDistanceKm: 0, workload: 0, customerDistanceKm: 21, peakHour: 0, batched: 0 })).toThrow(); expect(() => model.predictEta({ riderDistanceKm: Number.NaN, workload: 0, customerDistanceKm: 2, peakHour: 0, batched: 0 })).toThrow(); });
  it("derives peak hours using the configured operational timezone", () => { expect(isPeakHour(new Date("2026-08-31T03:00:00Z"), 330)).toBe(1); expect(isPeakHour(new Date("2026-08-31T05:30:00Z"), 330)).toBe(0); expect(isPeakHour(new Date("2026-08-31T12:30:00Z"), 330)).toBe(1); });
  it("validates enablement and prediction guardrails", () => { expect(loadMlConfig({ ML_LOGISTICS_ENABLED: "false" }).enabled).toBe(false); expect(() => loadMlConfig({ ML_LOGISTICS_ENABLED: "yes" })).toThrow(); expect(() => loadMlConfig({ ML_MAX_PREDICTION_MINUTES: "0" })).toThrow(); expect(() => loadMlConfig({ ML_FALLBACK_SPEED_KMH: "NaN" })).toThrow(); expect(() => loadMlConfig({ ML_TIMEZONE_OFFSET_MINUTES: "900" })).toThrow(); });
});
