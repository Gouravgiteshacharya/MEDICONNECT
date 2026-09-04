export type QuoteValidity = "VALID" | "EXPIRED";

export function classifyQuoteValidity(expiresAt: Date | null | undefined, now: Date = new Date()): QuoteValidity {
  if (!expiresAt || !Number.isFinite(expiresAt.getTime())) return "EXPIRED";
  if (!Number.isFinite(now.getTime())) throw new RangeError("now must be a valid date");
  return now.getTime() < expiresAt.getTime() ? "VALID" : "EXPIRED";
}
