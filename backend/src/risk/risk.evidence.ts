import { z } from "zod";
import { OperationalRiskError, type OperationalRiskDetection, type RiskRuleUnavailableReason } from "./risk.types.js";

// Canonical UTC strings only. No coercion or implicit Date serialization.
const iso = z.string().refine(value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
});
const timeout = z.strictObject({
  assignmentStatus: z.literal("TIMED_OUT"), offerExpiresAt: iso.nullable(), timedOutAt: iso,
});
const failed = z.strictObject({
  assignmentStatus: z.literal("FAILED"), eventType: z.literal("FAILED_DELIVERY"), occurredAt: iso,
  orderStatusAtFailure: z.enum(["CREATED", "PRESCRIPTION_PENDING", "PRESCRIPTION_APPROVED", "PRESCRIPTION_REJECTED", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "PICKED_UP_BY_CUSTOMER", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "REJECTED_BY_PHARMACY"]),
  requiresManualReview: z.literal(true),
});
const stale = z.strictObject({
  assignmentStatus: z.enum(["ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"]),
  locationFreshness: z.literal("STALE"), lastLocationAt: iso,
  freshnessThresholdMs: z.number().finite().nonnegative(), evaluatedAt: iso,
});
export type AssignmentOfferTimedOutEvidence = z.infer<typeof timeout>;
export type DeliveryFailedEvidence = z.infer<typeof failed>;
export type RiderLocationStaleEvidence = z.infer<typeof stale>;
export type RiskEvidence = AssignmentOfferTimedOutEvidence | DeliveryFailedEvidence | RiderLocationStaleEvidence;

/** Evidence registration is independent of the rule version. Unknown schemas fail closed. */
const registry = new Map<string, z.ZodType<RiskEvidence>>([
  ["ASSIGNMENT_OFFER_TIMED_OUT:1", timeout], ["DELIVERY_FAILED:1", failed], ["RIDER_LOCATION_STALE:1", stale],
]);

export function validateRiskEvidence(ruleCode: string, version: number, value: unknown): RiskEvidence {
  // Reject hidden fields, symbols, accessors, prototypes and broad objects before parsing.
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) throw new OperationalRiskError("INVALID_INPUT");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) throw new OperationalRiskError("INVALID_INPUT");
  }
  const result = registry.get(`${ruleCode}:${version}`)?.safeParse(value);
  if (!result?.success) throw new OperationalRiskError("INVALID_INPUT");
  return result.data;
}

export const riskUuid = z.uuid().transform(value => value.toLowerCase());
// Pure fact-validation helpers: no coercion, environment access or clock defaults.
export const riskOrderStatusAtFailureSchema = failed.shape.orderStatusAtFailure;
export function isRiskFactObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isRiskFactDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
export function riskFactIssue(value: unknown, valid: (value: unknown) => boolean): RiskRuleUnavailableReason | null {
  if (value === null || value === undefined) return "missing_required_fact";
  return valid(value) ? null : "invalid_required_fact";
}
export function riskAssignmentStateIssue(value: unknown): RiskRuleUnavailableReason | null {
  const issue = riskFactIssue(value, state => typeof state === "string" && state.length > 0);
  if (issue) return issue;
  return ["OFFERED", "ACCEPTED", "DECLINED", "TIMED_OUT", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "REASSIGNED", "FAILED"].includes(value as string) ? null : "unsupported_state";
}
export const riskCode = z.string().max(80).regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/);
export const riskIdentitySchema = z.strictObject({
  ruleCode: riskCode,
  ruleVersion: z.string().max(16).regex(/^[1-9][0-9]*$/),
  entityType: z.enum(["ORDER", "DELIVERY_ASSIGNMENT", "PRESCRIPTION", "PHARMACY_INVENTORY"]),
  entityId: riskUuid,
  occurrenceKey: z.string().max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
});
const detectionSchema = riskIdentitySchema.extend({
  evidenceSchemaVersion: z.number().int().positive().max(2147483647),
  orderId: riskUuid.nullish(), pharmacyId: riskUuid.nullish(),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH"]),
  resolutionPolicy: z.enum(["AUTO_RESOLVABLE", "MANUAL_RESOLUTION", "HISTORICAL_EVENT_ONLY"]),
  evidence: z.unknown(), sourceOccurredAt: z.date().nullish(), detectedAt: z.date(), evaluatedAt: z.date(),
});
export function parseRiskInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new OperationalRiskError("INVALID_INPUT");
  return result.data;
}

export function validateRiskDetection(input: unknown): OperationalRiskDetection {
  const data = parseRiskInput(detectionSchema, input);
  if (data.evaluatedAt < data.detectedAt || (data.sourceOccurredAt && data.sourceOccurredAt > data.detectedAt)) throw new OperationalRiskError("INVALID_INPUT");
  if (data.entityType === "ORDER" && data.orderId !== data.entityId) throw new OperationalRiskError("INVALID_INPUT");
  if (data.entityType === "PHARMACY_INVENTORY" && data.orderId != null) throw new OperationalRiskError("INVALID_INPUT");
  const evidence = validateRiskEvidence(data.ruleCode, data.evidenceSchemaVersion, data.evidence);
  // All currently registered evidence belongs to an assignment. Other entity types are reserved.
  if (data.entityType !== "DELIVERY_ASSIGNMENT") throw new OperationalRiskError("INVALID_INPUT");
  return structuredClone({ ...data, evidence });
}
