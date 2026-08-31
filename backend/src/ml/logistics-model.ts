export interface LogisticsFeatures { riderDistanceKm: number; workload: number; customerDistanceKm: number; peakHour: 0 | 1; batched: 0 | 1; }
export interface LogisticsPrediction { predictedCompletionMinutes: number; modelVersion: string; }
export interface LogisticsModel {
  predictDispatch(features: LogisticsFeatures): LogisticsPrediction;
  predictEta(features: LogisticsFeatures): LogisticsPrediction;
}

export const SYNTHETIC_MODEL_METADATA = {
  version: "synthetic-linear-v1",
  trainingSource: "SYNTHETIC" as const,
  seed: 20260831,
  samples: 5000,
  trainSamples: 4000,
  testSamples: 1000,
  metrics: { maeMinutes: 3.192645131197737, rmseMinutes: 4.0064824162855075, r2: 0.9622407770659755 },
};
const coefficients = { intercept: 7.773914387995135, riderDistanceKm: 2.4335756357911107, workload: 6.220751323746054, customerDistanceKm: 2.8041206830568215, peakHour: 7.592121440762866, batched: 4.692053279320171 };

function validate(features: LogisticsFeatures) {
  const values = Object.values(features);
  if (values.some((value) => !Number.isFinite(value))) throw new RangeError("ML features must be finite");
  if (features.riderDistanceKm < 0 || features.riderDistanceKm > 15 || features.workload < 0 || features.workload > 4 || features.customerDistanceKm < 0.5 || features.customerDistanceKm > 20 || ![0, 1].includes(features.peakHour) || ![0, 1].includes(features.batched)) throw new RangeError("ML features are outside the synthetic training range");
}
export class SyntheticLinearLogisticsModel implements LogisticsModel {
  private predict(features: LogisticsFeatures): LogisticsPrediction {
    validate(features);
    const predictedCompletionMinutes = coefficients.intercept + coefficients.riderDistanceKm * features.riderDistanceKm + coefficients.workload * features.workload + coefficients.customerDistanceKm * features.customerDistanceKm + coefficients.peakHour * features.peakHour + coefficients.batched * features.batched;
    return { predictedCompletionMinutes, modelVersion: SYNTHETIC_MODEL_METADATA.version };
  }
  predictDispatch(features: LogisticsFeatures) { return this.predict(features); }
  predictEta(features: LogisticsFeatures) { return this.predict(features); }
}
export function isPeakHour(date: Date, timezoneOffsetMinutes = 330): 0 | 1 { const hour = new Date(date.getTime() + timezoneOffsetMinutes * 60_000).getUTCHours(); return (hour >= 8 && hour < 11) || (hour >= 17 && hour < 21) ? 1 : 0; }
