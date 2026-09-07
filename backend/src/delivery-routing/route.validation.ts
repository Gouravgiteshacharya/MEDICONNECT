import { ApiError } from "../utils/ApiError.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseBatchId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new ApiError(400, "batchId must be a valid UUID", "INVALID_ROUTE_REQUEST");
  return value;
}
