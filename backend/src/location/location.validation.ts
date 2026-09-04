import { ApiError } from "../utils/ApiError.js";
import { validateCoordinates } from "./coordinates.js";

export interface LocationInput {
  latitude: number; longitude: number; accuracyMeters?: number; assignmentId?: string; batchId?: string;
}
const allowedKeys = new Set(["latitude", "longitude", "accuracyMeters", "assignmentId", "batchId"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message: string): never => { throw new ApiError(400, message, "INVALID_LOCATION_REQUEST"); };

export function parseLocationInput(body: unknown): LocationInput {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return invalid("request body must be a JSON object");
  const value = body as Record<string, unknown>;
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) return invalid(`unknown field(s): ${unknownKeys.join(", ")}`);
  if (!("latitude" in value) || !("longitude" in value)) return invalid("latitude and longitude are required");
  try { validateCoordinates({ latitude: value.latitude as number, longitude: value.longitude as number }); }
  catch (error) { return invalid((error as Error).message); }
  if (value.accuracyMeters !== undefined && (typeof value.accuracyMeters !== "number" || !Number.isFinite(value.accuracyMeters) || value.accuracyMeters < 0)) {
    return invalid("accuracyMeters must be a finite non-negative number");
  }
  for (const key of ["assignmentId", "batchId"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !uuidPattern.test(value[key] as string))) return invalid(`${key} must be a valid UUID`);
  }
  return value as unknown as LocationInput;
}
