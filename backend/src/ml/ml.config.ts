export interface MlConfig { enabled: boolean; maxPredictionMinutes: number; fallbackSpeedKmh: number; timezoneOffsetMinutes: number; }
export function loadMlConfig(environment: NodeJS.ProcessEnv = process.env): MlConfig {
  const raw = environment.ML_LOGISTICS_ENABLED ?? "true";
  if (raw !== "true" && raw !== "false") throw new Error("ML_LOGISTICS_ENABLED must be true or false");
  const maxPredictionMinutes = Number(environment.ML_MAX_PREDICTION_MINUTES ?? 240), fallbackSpeedKmh = Number(environment.ML_FALLBACK_SPEED_KMH ?? 20);
  const timezoneOffsetMinutes = Number(environment.ML_TIMEZONE_OFFSET_MINUTES ?? 330);
  if (!Number.isFinite(maxPredictionMinutes) || maxPredictionMinutes <= 0) throw new Error("ML_MAX_PREDICTION_MINUTES must be positive");
  if (!Number.isFinite(fallbackSpeedKmh) || fallbackSpeedKmh <= 0) throw new Error("ML_FALLBACK_SPEED_KMH must be positive");
  if (!Number.isInteger(timezoneOffsetMinutes) || timezoneOffsetMinutes < -720 || timezoneOffsetMinutes > 840) throw new Error("ML_TIMEZONE_OFFSET_MINUTES must be an integer from -720 to 840");
  return { enabled: raw === "true", maxPredictionMinutes, fallbackSpeedKmh, timezoneOffsetMinutes };
}
