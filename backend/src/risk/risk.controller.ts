import type { RequestHandler } from "express";
import { ApiError } from "../utils/ApiError.js";
import { toAdminRiskEvidence, toAdminRiskMetadata, type AdminOperationalRiskMetadata, type AdminOperationalRiskRecord } from "./risk.admin-read.js";
import type { OperationalRiskAssessmentRecord, OperationalRiskLifecycleResult, RiskLifecycleInput, RiskOpenQuery } from "./risk.types.js";
import { parseRiskAssessmentId, parseRiskDismissBody, parseRiskListQuery, parseRiskResolveBody, requireEmptyRiskBody, requireEmptyRiskQuery } from "./risk.validation.js";

export interface AdminRiskService {
  getAdminById(id: string): Promise<AdminOperationalRiskRecord | null>;
  listAdminOpen(query?: RiskOpenQuery): Promise<AdminOperationalRiskMetadata[]>;
  getById(id: string): Promise<OperationalRiskAssessmentRecord | null>;
  acknowledgeAssessment(input: RiskLifecycleInput): Promise<OperationalRiskLifecycleResult>;
  resolveAssessment(input: RiskLifecycleInput): Promise<OperationalRiskLifecycleResult>;
  dismissAssessment(input: RiskLifecycleInput): Promise<OperationalRiskLifecycleResult>;
}

/** Explicit HTTP projection: no domain links, actor identifiers, evidence or row spreads. */
function summary(value: AdminOperationalRiskMetadata | OperationalRiskAssessmentRecord) {
  const row = toAdminRiskMetadata(value);
  return {
    id: row.id, ruleCode: row.ruleCode, ruleVersion: row.ruleVersion, entityType: row.entityType,
    severity: row.severity, status: row.status, resolutionPolicy: row.resolutionPolicy,
    detectedAt: row.detectedAt.toISOString(), lastEvaluatedAt: row.lastEvaluatedAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null, dismissedAt: row.dismissedAt?.toISOString() ?? null,
    resolutionReasonCode: row.resolutionReason, revision: row.revision,
  };
}
function detail(row: AdminOperationalRiskRecord) {
  const result = summary(row);
  // Revalidate available evidence at the HTTP boundary as defense against faulty injected services.
  const evidence = row.evidence.status === "available"
    ? toAdminRiskEvidence(row.ruleCode, row.evidenceSchemaVersion, row.evidence.evidence)
    : { status: "unavailable" as const, reason: row.evidence.reason === "unknown_rule" ? "unknown_rule" as const : "invalid_evidence" as const };
  return Object.assign(result, { evidence });
}
const notFound = () => new ApiError(404, "Risk assessment not found.", "RISK_ASSESSMENT_NOT_FOUND");
async function persistence<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch { throw new ApiError(500, "Internal server error.", "INTERNAL_SERVER_ERROR"); }
}

export function createRiskController(service: () => AdminRiskService, now: () => Date) {
  // Sanitize before existing middleware can log an unexpected persistence/parser exception.
  const handle = (work: RequestHandler): RequestHandler => async (req, res, next) => {
    try { await work(req, res, next); }
    catch (error) { next(error instanceof ApiError ? error : new ApiError(500, "Internal server error.", "INTERNAL_SERVER_ERROR")); }
  };
  const mutate = (action: "acknowledgeAssessment" | "resolveAssessment" | "dismissAssessment"): RequestHandler => handle(async (req, res) => {
    const id = parseRiskAssessmentId(req.params.id);
    requireEmptyRiskQuery(req.query);
    let reason: RiskLifecycleInput["reason"];
    if (action === "acknowledgeAssessment") requireEmptyRiskBody(req.body);
    if (action === "resolveAssessment") reason = parseRiskResolveBody(req.body).reason;
    if (action === "dismissAssessment") reason = parseRiskDismissBody(req.body).reason;
    const riskService = service();
    // Strict read is intentional. Admin evidence tolerance never authorizes mutations.
    const current = await persistence(() => riskService.getById(id));
    if (!current) throw notFound();
    const result = await persistence(() => riskService[action]({ id, expectedRevision: current.revision, actorId: req.user!.id, at: now(), ...(reason ? { reason } : {}) }));
    if (result.status === "not_found") throw notFound();
    if (result.status === "conflict") throw new ApiError(409, "Risk assessment changed or transition is not allowed.", "RISK_ASSESSMENT_CONFLICT");
    res.json({ data: summary(result.record) });
  });
  return {
    list: handle(async (req, res) => {
      const query = parseRiskListQuery(req.query);
      const riskService = service();
      const records = await persistence(() => riskService.listAdminOpen(query));
      res.json({ data: records.map(summary), pagination: { limit: query.limit, offset: query.offset } });
    }),
    detail: handle(async (req, res) => {
      const id = parseRiskAssessmentId(req.params.id); requireEmptyRiskQuery(req.query);
      const riskService = service();
      const record = await persistence(() => riskService.getAdminById(id));
      if (!record) throw notFound();
      res.json({ data: detail(record) });
    }),
    acknowledge: mutate("acknowledgeAssessment"), resolve: mutate("resolveAssessment"), dismiss: mutate("dismissAssessment"),
  };
}
