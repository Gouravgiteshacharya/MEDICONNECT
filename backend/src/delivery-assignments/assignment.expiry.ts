/** Persisted deadlines take precedence; null retains legacy configuration behavior. */
export function assignmentExpiresAt(assignedAt: Date, timeoutMs: number, offerExpiresAt?: Date | null): Date {
  return offerExpiresAt ?? new Date(assignedAt.getTime() + timeoutMs);
}
export function isAssignmentOfferExpired(assignedAt: Date, now: Date, timeoutMs: number, offerExpiresAt?: Date | null): boolean {
  return now.getTime() >= assignmentExpiresAt(assignedAt, timeoutMs, offerExpiresAt).getTime();
}
