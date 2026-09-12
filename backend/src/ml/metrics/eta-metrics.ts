export interface EtaObservation {
  actualMinutes: number;
  predictedMinutes: number;
}

/** Durations/errors are minutes. Every rate is a fraction in [0, 1]. */
export interface EtaMetrics {
  mae: number;
  medianAbsoluteError: number;
  rmse: number;
  p90AbsoluteError: number;
  meanSignedBias: number;
  medianSignedLateness: number;
  p90SignedLateness: number;
  p90LateMinutes: number;
  within5MinutesRate: number;
  within10MinutesRate: number;
  within15MinutesRate: number;
  overPromiseRate: number;
  underPromiseRate: number;
  withinPredictedEtaRate: number;
}

export type EtaEvaluationResult =
  | { status: "evaluated"; sampleCount: number; excludedCount: number; metrics: EtaMetrics }
  | { status: "unavailable"; reason: "no_valid_observations"; sampleCount: 0; excludedCount: number };

// Scale before summing/squaring so finite extreme inputs do not overflow.
function scaledMean(values: readonly number[], scale: number): number {
  if (scale === 0) return 0;
  const normalizedMean = values.reduce((sum, value) => sum + value / scale, 0) / values.length;
  return Math.max(-1, Math.min(1, normalizedMean)) * scale;
}

// Conventional median: average the middle two for even sample counts.
function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : sorted[middle - 1] / 2 + sorted[middle] / 2;
}

// Nearest-rank P90: ceil(0.90 * N), converted from one-based rank to index.
function p90(sorted: readonly number[]): number {
  return sorted[Math.ceil(0.90 * sorted.length) - 1];
}

/**
 * Pure offline evaluation. Invalid rows are excluded and counted.
 * error/bias = predicted - actual; lateness = actual - predicted.
 * Positive bias allows extra time; positive lateness exceeds the prediction.
 */
export function evaluateEta(observations: readonly EtaObservation[]): EtaEvaluationResult {
  const errors: number[] = [];
  let excludedCount = 0;
  for (const observation of observations) {
    if (!Number.isFinite(observation?.actualMinutes) || observation.actualMinutes <= 0
      || !Number.isFinite(observation?.predictedMinutes) || observation.predictedMinutes < 0) {
      excludedCount++;
      continue;
    }
    errors.push(observation.predictedMinutes - observation.actualMinutes);
  }
  const sampleCount = errors.length;
  if (sampleCount === 0) {
    return { status: "unavailable", reason: "no_valid_observations", sampleCount: 0, excludedCount };
  }
  const absoluteErrors = errors.map(Math.abs).sort((a, b) => a - b);
  const lateness = errors.map(error => -error).sort((a, b) => a - b);
  const lateMinutes = lateness.map(value => Math.max(value, 0));
  const scale = absoluteErrors[sampleCount - 1];
  const meanSquaredNormalizedError = scale === 0 ? 0
    : errors.reduce((sum, error) => sum + (error / scale) ** 2, 0) / sampleCount;
  const rate = (predicate: (error: number) => boolean): number => errors.filter(predicate).length / sampleCount;
  return {
    status: "evaluated", sampleCount, excludedCount,
    metrics: {
      mae: scaledMean(absoluteErrors, scale),
      medianAbsoluteError: median(absoluteErrors),
      rmse: Math.sqrt(Math.min(1, meanSquaredNormalizedError)) * scale,
      p90AbsoluteError: p90(absoluteErrors),
      meanSignedBias: scaledMean(errors, scale),
      medianSignedLateness: median(lateness),
      p90SignedLateness: p90(lateness),
      p90LateMinutes: p90(lateMinutes),
      within5MinutesRate: rate(error => Math.abs(error) <= 5),
      within10MinutesRate: rate(error => Math.abs(error) <= 10),
      within15MinutesRate: rate(error => Math.abs(error) <= 15),
      overPromiseRate: rate(error => error < 0),
      underPromiseRate: rate(error => error > 0),
      withinPredictedEtaRate: rate(error => error >= 0),
    },
  };
}
