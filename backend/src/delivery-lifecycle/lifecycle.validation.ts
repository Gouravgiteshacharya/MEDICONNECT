import { ApiError } from "../utils/ApiError.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message: string): never => { throw new ApiError(400, message, "INVALID_LIFECYCLE_REQUEST"); };
export function parseLifecycleAssignmentId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) return invalid("assignmentId must be a valid UUID");
  return value;
}
export function requireEmptyLifecycleBody(body: unknown): void {
  if (body === undefined || body === null) return;
  if (typeof body !== "object" || Array.isArray(body) || Object.keys(body as object).length) invalid("request body must be empty");
}
export function parseFailureBody(body: unknown): { reason: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("request body must be a JSON object");
  const value = body as Record<string, unknown>;
  const unknown = Object.keys(value).filter((key) => key !== "reason");
  if (unknown.length) return invalid(`unknown field(s): ${unknown.join(", ")}`);
  if (typeof value.reason !== "string" || !value.reason.trim() || value.reason.trim().length > 500) return invalid("reason must be between 1 and 500 characters");
  return { reason: value.reason.trim() };
}
