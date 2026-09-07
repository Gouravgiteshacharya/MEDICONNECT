export interface AssignmentConfig { offerTimeoutMs: number; }
export const DEFAULT_ASSIGNMENT_OFFER_TIMEOUT_SECONDS = 30;

export function loadAssignmentConfig(environment: NodeJS.ProcessEnv = process.env): AssignmentConfig {
  const raw = environment.DELIVERY_ASSIGNMENT_OFFER_TIMEOUT_SECONDS ?? String(DEFAULT_ASSIGNMENT_OFFER_TIMEOUT_SECONDS);
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("DELIVERY_ASSIGNMENT_OFFER_TIMEOUT_SECONDS must be a positive number");
  const offerTimeoutMs = seconds * 1000;
  if (!Number.isSafeInteger(offerTimeoutMs)) throw new Error("DELIVERY_ASSIGNMENT_OFFER_TIMEOUT_SECONDS is too large");
  return { offerTimeoutMs };
}
