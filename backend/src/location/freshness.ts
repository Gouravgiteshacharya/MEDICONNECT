export type LocationFreshness = "FRESH" | "STALE" | "UNAVAILABLE";
export interface FreshnessOptions { now?: Date; freshForMs: number; }

export function classifyLocationFreshness(lastLocationAt: Date | null | undefined, options: FreshnessOptions): LocationFreshness {
  if (!lastLocationAt || !Number.isFinite(lastLocationAt.getTime())) return "UNAVAILABLE";
  if (!Number.isFinite(options.freshForMs) || options.freshForMs < 0) throw new RangeError("freshForMs must be non-negative");
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new RangeError("now must be a valid date");
  return Math.max(0, now.getTime() - lastLocationAt.getTime()) <= options.freshForMs ? "FRESH" : "STALE";
}
