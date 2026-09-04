import { ApiError } from "../utils/ApiError.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message: string): never => { throw new ApiError(400, message, "INVALID_ASSIGNMENT_REQUEST"); };

export interface CreateOfferInput { orderId: string; riderId: string; }
export function parseCreateOfferInput(body: unknown): CreateOfferInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("request body must be a JSON object");
  const value = body as Record<string, unknown>;
  const unknown = Object.keys(value).filter((key) => key !== "orderId" && key !== "riderId");
  if (unknown.length) return invalid(`unknown field(s): ${unknown.join(", ")}`);
  for (const key of ["orderId", "riderId"] as const) {
    if (typeof value[key] !== "string" || !uuidPattern.test(value[key])) return invalid(`${key} must be a valid UUID`);
  }
  return { orderId: value.orderId as string, riderId: value.riderId as string };
}

export function parseAssignmentId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) return invalid("assignmentId must be a valid UUID");
  return value;
}

export function requireEmptyBody(body: unknown): void {
  if (body === undefined || body === null) return;
  if (typeof body !== "object" || Array.isArray(body) || Object.keys(body as object).length) invalid("request body must be empty");
}
