import { z } from "zod";
import { adminRiskMetadataSelect, toAdminRiskMetadata, toAdminRiskEvidence, type AdminOperationalRiskMetadata, type AdminOperationalRiskRecord } from "./risk.admin-read.js";
import type { PrismaClient, Prisma, OperationalRiskAssessment } from "../../generated/prisma/client.js";
import { parseRiskInput, riskCode, riskIdentitySchema, riskUuid, validateRiskDetection, validateRiskEvidence } from "./risk.evidence.js";
import { OperationalRiskError, type OperationalRiskAssessmentRecord, type OperationalRiskDetection, type OperationalRiskLifecycleResult, type OperationalRiskOccurrenceIdentity, type OperationalRiskStatus, type RiskLifecycleInput, type RiskOpenQuery, type RiskPage } from "./risk.types.js";

export interface RiskLifecycleUpdate extends RiskLifecycleInput {
  expectedStatus: OperationalRiskStatus;
  targetStatus: "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";
}
export interface OperationalRiskRepository {
  getAdminById(id: string): Promise<AdminOperationalRiskRecord | null>;
  listAdminOpen(query?: RiskOpenQuery): Promise<AdminOperationalRiskMetadata[]>;
  createOrGetOccurrence(input: OperationalRiskDetection): Promise<OperationalRiskAssessmentRecord>;
  getById(id: string): Promise<OperationalRiskAssessmentRecord | null>;
  getByOccurrence(identity: OperationalRiskOccurrenceIdentity): Promise<OperationalRiskAssessmentRecord | null>;
  updateLifecycle(input: RiskLifecycleUpdate): Promise<OperationalRiskLifecycleResult>;
  listByOrder(orderId: string, page?: RiskPage): Promise<OperationalRiskAssessmentRecord[]>;
  listOpen(query?: RiskOpenQuery): Promise<OperationalRiskAssessmentRecord[]>;
}

const lifecycleSchema = z.strictObject({
  id: riskUuid, expectedRevision: z.number().int().min(0).max(2147483646), at: z.date(),
  actorId: riskUuid.nullable(),
  reason: z.enum(["CONDITION_CLEARED", "OPERATOR_RESOLVED", "FALSE_POSITIVE", "DUPLICATE_CONTEXT"]).optional(),
  expectedStatus: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]),
  targetStatus: z.enum(["ACKNOWLEDGED", "RESOLVED", "DISMISSED"]),
});
export function validateLifecycle(input: RiskLifecycleUpdate): RiskLifecycleUpdate {
  const data = parseRiskInput(lifecycleSchema, input);
  if (data.targetStatus === "ACKNOWLEDGED") {
    if (data.actorId === null || data.reason !== undefined) throw new OperationalRiskError("INVALID_INPUT");
  } else if (data.targetStatus === "DISMISSED") {
    if (data.actorId === null || !["FALSE_POSITIVE", "DUPLICATE_CONTEXT"].includes(data.reason ?? "")) throw new OperationalRiskError("INVALID_INPUT");
  } else if (data.actorId === null ? data.reason !== "CONDITION_CLEARED" : data.reason !== "OPERATOR_RESOLVED") {
    throw new OperationalRiskError("INVALID_INPUT");
  }
  return structuredClone(data);
}

/** Check before CAS, then reload on a lost race. Terminal records never reopen. */
export function lifecycleResult(current: OperationalRiskAssessmentRecord, input: RiskLifecycleUpdate): OperationalRiskLifecycleResult | null {
  if (current.status === input.targetStatus) return { status: "idempotent", record: current };
  if (current.status === "RESOLVED" || current.status === "DISMISSED" || current.revision !== input.expectedRevision || current.status !== input.expectedStatus) return { status: "conflict", record: current };
  if (input.at < current.detectedAt || input.at < current.lastEvaluatedAt || (current.acknowledgedAt && input.at < current.acknowledgedAt)) return { status: "conflict", record: current };
  if (input.targetStatus === "RESOLVED" && input.actorId === null && current.resolutionPolicy !== "AUTO_RESOLVABLE") return { status: "conflict", record: current };
  return null;
}

const pageShape = { limit: z.number().int().min(1).max(100).default(25), offset: z.number().int().min(0).max(1_000_000).default(0) };
const pageSchema = z.strictObject(pageShape);
const openSchema = z.strictObject({ ...pageShape, severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH"]).optional(), ruleCode: riskCode.optional() });
const occurrenceFields = ["ruleCode", "ruleVersion", "entityType", "entityId", "occurrenceKey"];

function isOccurrenceConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002" || !("meta" in error)) return false;
  const target = (error.meta as { target?: unknown } | null)?.target;
  return target === "operational_risk_occurrence_key" || (Array.isArray(target) && target.length === occurrenceFields.length && occurrenceFields.every(field => target.includes(field)));
}
function toRecord(row: OperationalRiskAssessment): OperationalRiskAssessmentRecord {
  const reason = row.resolutionReason === null ? null : parseRiskInput(z.enum(["CONDITION_CLEARED", "OPERATOR_RESOLVED", "FALSE_POSITIVE", "DUPLICATE_CONTEXT"]), row.resolutionReason);
  return structuredClone({ ...row, resolutionReason: reason, evidence: validateRiskEvidence(row.ruleCode, row.evidenceSchemaVersion, row.evidence) });
}

/** Inject the generated delegate (or an integration-style fake). No global client or app wiring. */
export class PrismaOperationalRiskRepository implements OperationalRiskRepository {
  constructor(private readonly store: Pick<PrismaClient["operationalRiskAssessment"], "create" | "findUnique" | "findMany" | "updateMany">) {}

  async getAdminById(id: string): Promise<AdminOperationalRiskRecord | null> {
    const key = parseRiskInput(riskUuid, id);
    return this.persist(async () => {
      const row = await this.store.findUnique({ where: { id: key }, select: { ...adminRiskMetadataSelect, evidence: true } });
      if (!row) return null;
      const metadata = toAdminRiskMetadata(row);
      return Object.assign(metadata, { evidence: toAdminRiskEvidence(metadata.ruleCode, metadata.evidenceSchemaVersion, row.evidence) });
    });
  }

  async listAdminOpen(query: RiskOpenQuery = {}): Promise<AdminOperationalRiskMetadata[]> {
    const { limit, offset, severity, ruleCode } = parseRiskInput(openSchema, query);
    return this.persist(async () => (await this.store.findMany({
      where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, ...(severity ? { severity } : {}), ...(ruleCode ? { ruleCode } : {}) },
      orderBy: [{ detectedAt: "desc" }, { id: "asc" }], take: limit, skip: offset, select: adminRiskMetadataSelect,
    })).map(toAdminRiskMetadata));
  }

  private async persist<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch { throw new OperationalRiskError("PERSISTENCE_FAILED"); }
  }

  async createOrGetOccurrence(input: OperationalRiskDetection): Promise<OperationalRiskAssessmentRecord> {
    const data = validateRiskDetection(input);
    const { evaluatedAt, ...fields } = data;
    return this.persist(async () => {
      try {
        return toRecord(await this.store.create({ data: { ...fields, evidence: { ...fields.evidence }, lastEvaluatedAt: evaluatedAt, status: "OPEN" } }));
      } catch (error) {
        if (!isOccurrenceConflict(error)) throw error;
        const existing = await this.store.findUnique({ where: { occurrence: this.identity(data) } });
        if (!existing) throw new OperationalRiskError("PERSISTENCE_FAILED");
        return toRecord(existing);
      }
    });
  }

  private identity(input: OperationalRiskOccurrenceIdentity): OperationalRiskOccurrenceIdentity {
    return { ruleCode: input.ruleCode, ruleVersion: input.ruleVersion, entityType: input.entityType, entityId: input.entityId, occurrenceKey: input.occurrenceKey };
  }

  async getById(id: string): Promise<OperationalRiskAssessmentRecord | null> {
    const key = parseRiskInput(riskUuid, id);
    return this.persist(async () => { const row = await this.store.findUnique({ where: { id: key } }); return row ? toRecord(row) : null; });
  }

  async getByOccurrence(identity: OperationalRiskOccurrenceIdentity): Promise<OperationalRiskAssessmentRecord | null> {
    const key = parseRiskInput(riskIdentitySchema, identity);
    return this.persist(async () => { const row = await this.store.findUnique({ where: { occurrence: key } }); return row ? toRecord(row) : null; });
  }

  async updateLifecycle(input: RiskLifecycleUpdate): Promise<OperationalRiskLifecycleResult> {
    const command = validateLifecycle(input);
    const current = await this.getById(command.id);
    if (!current) return { status: "not_found" };
    const settled = lifecycleResult(current, command);
    if (settled) return settled;
    const data: Prisma.OperationalRiskAssessmentUpdateManyMutationInput = { status: command.targetStatus, revision: { increment: 1 } };
    if (command.targetStatus === "ACKNOWLEDGED") Object.assign(data, { acknowledgedAt: command.at, acknowledgedByAdminId: command.actorId });
    if (command.targetStatus === "RESOLVED") Object.assign(data, { resolvedAt: command.at, resolvedByAdminId: command.actorId, resolutionReason: command.reason });
    if (command.targetStatus === "DISMISSED") Object.assign(data, { dismissedAt: command.at, dismissedByAdminId: command.actorId, resolutionReason: command.reason });
    return this.persist(async () => {
      const result = await this.store.updateMany({ where: { id: command.id, revision: command.expectedRevision, status: command.expectedStatus }, data });
      const row = await this.store.findUnique({ where: { id: command.id } });
      if (!row) return { status: "not_found" };
      const record = toRecord(row);
      if (result.count === 1 && record.revision === command.expectedRevision + 1 && record.status === command.targetStatus) return { status: "updated", record };
      return { status: record.status === command.targetStatus ? "idempotent" : "conflict", record };
    });
  }

  async listByOrder(orderId: string, page: RiskPage = {}): Promise<OperationalRiskAssessmentRecord[]> {
    const id = parseRiskInput(riskUuid, orderId);
    const { limit, offset } = parseRiskInput(pageSchema, page);
    return this.persist(async () => (await this.store.findMany({ where: { orderId: id }, orderBy: [{ detectedAt: "desc" }, { id: "asc" }], take: limit, skip: offset })).map(toRecord));
  }

  async listOpen(query: RiskOpenQuery = {}): Promise<OperationalRiskAssessmentRecord[]> {
    const { limit, offset, severity, ruleCode } = parseRiskInput(openSchema, query);
    return this.persist(async () => (await this.store.findMany({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, ...(severity ? { severity } : {}), ...(ruleCode ? { ruleCode } : {}) }, orderBy: [{ detectedAt: "desc" }, { id: "asc" }], take: limit, skip: offset })).map(toRecord));
  }
}
