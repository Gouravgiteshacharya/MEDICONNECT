import { ApiError } from "../middleware/errors.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseTrackingOrderId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new ApiError(400, "orderId must be a valid UUID", "INVALID_TRACKING_REQUEST");
  return value;
}
