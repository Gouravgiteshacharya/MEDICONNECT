import { ApiError } from "../utils/ApiError.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseBatchInput(body: unknown): { riderId: string; candidateOrderId: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "request body must be a JSON object", "INVALID_BATCH_REQUEST");
  const value = body as Record<string, unknown>, unknown = Object.keys(value).filter((key) => key !== "riderId" && key !== "candidateOrderId");
  if (unknown.length) throw new ApiError(400, `unknown field(s): ${unknown.join(", ")}`, "INVALID_BATCH_REQUEST");
  for (const key of ["riderId", "candidateOrderId"] as const) if (typeof value[key] !== "string" || !uuid.test(value[key])) throw new ApiError(400, `${key} must be a valid UUID`, "INVALID_BATCH_REQUEST");
  return { riderId: value.riderId as string, candidateOrderId: value.candidateOrderId as string };
}
