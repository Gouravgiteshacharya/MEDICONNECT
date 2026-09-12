export interface EtaBaselineInput {
  distanceKm: number;
  fallbackSpeedKmh: number;
}

export type EtaBaselineResult =
  | { status: "predicted"; predictedMinutes: number; source: "distance_speed_baseline" }
  | { status: "unavailable"; reason: "invalid_distance" | "invalid_speed" | "prediction_overflow" };

/** Offline distance baseline; speed is explicit and no operational state is read. */
export function predictEtaBaseline(input: EtaBaselineInput): EtaBaselineResult {
  if (!Number.isFinite(input.distanceKm) || input.distanceKm < 0) {
    return { status: "unavailable", reason: "invalid_distance" };
  }
  if (!Number.isFinite(input.fallbackSpeedKmh) || input.fallbackSpeedKmh <= 0) {
    return { status: "unavailable", reason: "invalid_speed" };
  }
  const predictedMinutes = Math.ceil(input.distanceKm / input.fallbackSpeedKmh * 60);
  if (!Number.isFinite(predictedMinutes)) {
    return { status: "unavailable", reason: "prediction_overflow" };
  }
  return { status: "predicted", predictedMinutes, source: "distance_speed_baseline" };
}
