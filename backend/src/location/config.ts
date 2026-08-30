export interface LocationConfig { sampleIntervalMs: number; freshnessThresholdMs: number; }
export const DEFAULT_LOCATION_SAMPLE_INTERVAL_SECONDS = 15;
export const DEFAULT_LOCATION_FRESHNESS_SECONDS = 60;

function secondsFromEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

export function loadLocationConfig(): LocationConfig {
  return {
    sampleIntervalMs: secondsFromEnvironment("RIDER_LOCATION_SAMPLE_INTERVAL_SECONDS", DEFAULT_LOCATION_SAMPLE_INTERVAL_SECONDS) * 1000,
    freshnessThresholdMs: secondsFromEnvironment("RIDER_LOCATION_FRESHNESS_SECONDS", DEFAULT_LOCATION_FRESHNESS_SECONDS) * 1000,
  };
}
