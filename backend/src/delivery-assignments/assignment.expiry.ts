export function assignmentExpiresAt(assignedAt: Date, timeoutMs: number): Date {
  return new Date(assignedAt.getTime() + timeoutMs);
}
export function isAssignmentOfferExpired(assignedAt: Date, now: Date, timeoutMs: number): boolean {
  return now.getTime() >= assignmentExpiresAt(assignedAt, timeoutMs).getTime();
}
