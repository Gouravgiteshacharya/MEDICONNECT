export const INVENTORY_FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1_000;

export function classifyInventoryFreshness(
  lastUpdated: Date,
  now = new Date(),
): "FRESH" | "STALE" {
  return now.getTime() - lastUpdated.getTime() <= INVENTORY_FRESHNESS_THRESHOLD_MS
    ? "FRESH"
    : "STALE";
}
