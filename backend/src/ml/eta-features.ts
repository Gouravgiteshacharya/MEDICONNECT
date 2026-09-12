export const ETA_FEATURE_CONTRACT_VERSION = "eta-checkout-features-v1" as const;
export const ETA_ORDERED_FEATURES = Object.freeze([
  "distanceKm", "itemCount", "hourSin", "hourCos", "isMonday", "isTuesday",
  "isWednesday", "isThursday", "isFriday", "isSaturday",
] as const);

export interface CheckoutEtaFeatures {
  readonly distanceKm: number;
  readonly itemCount: number;
  readonly hourOfDay: number;
  /** Sunday = 0. */
  readonly dayOfWeek: number;
}
export type EtaFeatureVector = readonly [number, number, number, number, number, number, number, number, number, number];
export type EtaFeatureResult =
  | { readonly status: "encoded"; readonly features: EtaFeatureVector }
  | { readonly status: "unavailable"; readonly reason: "invalid_shape" | "invalid_distance" | "invalid_item_count" | "invalid_hour" | "invalid_weekday" };

/** Strict raw-input allowlist rejects benchmarks, labels and operational fields. No coercion. */
export function encodeCheckoutFeatures(input: unknown): EtaFeatureResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)
    || Object.keys(input).sort().join(",") !== "dayOfWeek,distanceKm,hourOfDay,itemCount") {
    return { status: "unavailable", reason: "invalid_shape" };
  }
  const row = input as Record<string, unknown>;
  const { distanceKm, itemCount, hourOfDay, dayOfWeek } = row;
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm) || distanceKm < 0) return { status: "unavailable", reason: "invalid_distance" };
  if (typeof itemCount !== "number" || !Number.isInteger(itemCount) || itemCount <= 0) return { status: "unavailable", reason: "invalid_item_count" };
  if (typeof hourOfDay !== "number" || !Number.isInteger(hourOfDay) || hourOfDay < 0 || hourOfDay > 23) return { status: "unavailable", reason: "invalid_hour" };
  if (typeof dayOfWeek !== "number" || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return { status: "unavailable", reason: "invalid_weekday" };
  const angle = 2 * Math.PI * hourOfDay / 24;
  return { status: "encoded", features: [distanceKm, itemCount, Math.sin(angle), Math.cos(angle),
    Number(dayOfWeek === 1), Number(dayOfWeek === 2), Number(dayOfWeek === 3),
    Number(dayOfWeek === 4), Number(dayOfWeek === 5), Number(dayOfWeek === 6)] };
}
