export const DISPATCH_FEATURE_CONTRACT_VERSION = "dispatch-acceptance-features-v1" as const;
export const DISPATCH_ORDERED_FEATURES = Object.freeze([
  "riderDistanceKm", "activeWorkload", "hourSin", "hourCos", "isMonday", "isTuesday",
  "isWednesday", "isThursday", "isFriday", "isSaturday",
] as const);

export interface DispatchAcceptanceFeatures {
  readonly riderDistanceKm: number;
  readonly activeWorkload: number;
  readonly hourOfDay: number;
  /** Sunday = 0. */
  readonly dayOfWeek: number;
}
export type DispatchFeatureVector = readonly [number, number, number, number, number, number, number, number, number, number];
export type DispatchFeatureResult =
  | { readonly status: "encoded"; readonly features: DispatchFeatureVector }
  | { readonly status: "unavailable"; readonly reason: "invalid_shape" | "invalid_distance" | "invalid_workload" | "invalid_hour" | "invalid_weekday" };

/** Strict raw-input allowlist rejects benchmarks, labels and operational fields. No coercion. */
export function encodeDispatchFeatures(input: unknown): DispatchFeatureResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)
    || Object.keys(input).sort().join(",") !== "activeWorkload,dayOfWeek,hourOfDay,riderDistanceKm") {
    return { status: "unavailable", reason: "invalid_shape" };
  }
  const row = input as Record<string, unknown>;
  const { riderDistanceKm, activeWorkload, hourOfDay, dayOfWeek } = row;
  if (typeof riderDistanceKm !== "number" || !Number.isFinite(riderDistanceKm) || riderDistanceKm < 0) return { status: "unavailable", reason: "invalid_distance" };
  if (typeof activeWorkload !== "number" || !Number.isInteger(activeWorkload) || activeWorkload < 0) return { status: "unavailable", reason: "invalid_workload" };
  if (typeof hourOfDay !== "number" || !Number.isInteger(hourOfDay) || hourOfDay < 0 || hourOfDay > 23) return { status: "unavailable", reason: "invalid_hour" };
  if (typeof dayOfWeek !== "number" || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return { status: "unavailable", reason: "invalid_weekday" };
  const angle = 2 * Math.PI * hourOfDay / 24;
  return { status: "encoded", features: [riderDistanceKm, activeWorkload, Math.sin(angle), Math.cos(angle),
    Number(dayOfWeek === 1), Number(dayOfWeek === 2), Number(dayOfWeek === 3),
    Number(dayOfWeek === 4), Number(dayOfWeek === 5), Number(dayOfWeek === 6)] };
}
