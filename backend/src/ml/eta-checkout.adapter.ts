import type { CheckoutEtaFeatures } from "./eta-features.js";

export interface EtaOrderSnapshot {
  readonly deliveryDistanceKm: number | null;
  readonly placedAt: Date;
  readonly items: readonly unknown[];
}
export type EtaFeatureResult =
  | { readonly status: "ready"; readonly features: CheckoutEtaFeatures }
  | { readonly status: "unavailable"; readonly reason: "invalid_distance" | "invalid_items" | "invalid_placed_at" | "invalid_timezone" | "invalid_snapshot" };

/** Same whole-week reduction as the M10 extractor; no ambient clock or encoding. */
export function assembleCheckoutEtaFeatures(input: EtaOrderSnapshot, timezoneOffsetMinutes: number): EtaFeatureResult {
  try {
    if (typeof input.deliveryDistanceKm !== "number" || !Number.isFinite(input.deliveryDistanceKm) || input.deliveryDistanceKm < 0) return { status: "unavailable", reason: "invalid_distance" };
    if (!Array.isArray(input.items) || input.items.length === 0) return { status: "unavailable", reason: "invalid_items" };
    if (!(input.placedAt instanceof Date) || !Number.isFinite(input.placedAt.getTime())) return { status: "unavailable", reason: "invalid_placed_at" };
    if (!Number.isInteger(timezoneOffsetMinutes) || timezoneOffsetMinutes < -720 || timezoneOffsetMinutes > 840) return { status: "unavailable", reason: "invalid_timezone" };
    const local = new Date(input.placedAt.getTime() % (7 * 86_400_000) + timezoneOffsetMinutes * 60_000);
    return { status: "ready", features: { distanceKm: input.deliveryDistanceKm, itemCount: input.items.length, hourOfDay: local.getUTCHours(), dayOfWeek: local.getUTCDay() } };
  } catch { return { status: "unavailable", reason: "invalid_snapshot" }; }
}
