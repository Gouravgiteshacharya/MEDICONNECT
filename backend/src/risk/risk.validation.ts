import { z } from "zod";
import { riskCode, riskUuid } from "./risk.evidence.js";
import { ApiError } from "../utils/ApiError.js";

function requestValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "Invalid risk assessment request.", "INVALID_RISK_REQUEST");
  return result.data;
}
const integerQuery = (minimum: number, maximum: number) => z.string().max(7).regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(z.number().int().min(minimum).max(maximum));
const listQuery = z.strictObject({
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH"]).optional(), ruleCode: riskCode.optional(),
  limit: integerQuery(1, 100).default(25), offset: integerQuery(0, 1_000_000).default(0),
});
export function parseRiskListQuery(value: unknown) { return requestValue(listQuery, value); }
export function parseRiskAssessmentId(value: unknown) { return requestValue(riskUuid, value); }
export function parseRiskResolveBody(value: unknown) { return requestValue(z.strictObject({ reason: z.literal("OPERATOR_RESOLVED") }), value); }
export function parseRiskDismissBody(value: unknown) { return requestValue(z.strictObject({ reason: z.enum(["FALSE_POSITIVE", "DUPLICATE_CONTEXT"]) }), value); }
export function requireEmptyRiskBody(value: unknown) { requestValue(z.strictObject({}), value == null ? {} : value); }
export function requireEmptyRiskQuery(value: unknown) { requestValue(z.strictObject({}), value); }
