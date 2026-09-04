import { ApiError } from "../utils/ApiError.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseDispatchOrderId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new ApiError(400, "orderId must be a valid UUID", "INVALID_DISPATCH_REQUEST");
  return value;
}
export function requireEmptyDispatchBody(body: unknown): void {
  if (body === undefined || body === null) return;
  if (typeof body !== "object" || Array.isArray(body) || Object.keys(body as object).length) throw new ApiError(400, "request body must be empty", "INVALID_DISPATCH_REQUEST");
}
