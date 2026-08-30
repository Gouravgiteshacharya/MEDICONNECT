import { ApiError } from "../middleware/errors.js";

export interface DeliveryQuoteInput { pharmacyId: string; deliveryAddressId: string; }
const allowedKeys = new Set(["pharmacyId", "deliveryAddressId"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message: string): never => { throw new ApiError(400, message, "INVALID_QUOTE_REQUEST"); };

export function parseDeliveryQuoteInput(body: unknown): DeliveryQuoteInput {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return invalid("request body must be a JSON object");
  const value = body as Record<string, unknown>;
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length) return invalid(`unknown field(s): ${unknown.join(", ")}`);
  for (const key of ["pharmacyId", "deliveryAddressId"] as const) {
    if (typeof value[key] !== "string" || !uuidPattern.test(value[key] as string)) return invalid(`${key} must be a valid UUID`);
  }
  return { pharmacyId: value.pharmacyId as string, deliveryAddressId: value.deliveryAddressId as string };
}
