import { randomUUID } from "node:crypto";
import type { OperationalRiskAssessment, Prisma, PrismaClient } from "../generated/prisma/client.js";
import { PrismaOperationalRiskRepository } from "../src/risk/risk.repository.js";
import type { OperationalRiskDetection } from "../src/risk/risk.types.js";

export const entityId = "11111111-1111-4111-8111-111111111111";
export const orderId = "22222222-2222-4222-8222-222222222222";
export const actorId = "33333333-3333-4333-8333-333333333333";
export const secondActorId = "44444444-4444-4444-8444-444444444444";
export const time = new Date("2026-09-14T00:00:00.000Z");
export const later = new Date("2026-09-14T00:01:00.000Z");
export function detection(overrides: Partial<OperationalRiskDetection> = {}): OperationalRiskDetection {
  return structuredClone({ ruleCode: "ASSIGNMENT_OFFER_TIMED_OUT", ruleVersion: "1", evidenceSchemaVersion: 1,
    entityType: "DELIVERY_ASSIGNMENT", entityId, orderId, occurrenceKey: entityId, severity: "INFO",
    resolutionPolicy: "HISTORICAL_EVENT_ONLY", evidence: { assignmentStatus: "TIMED_OUT", offerExpiresAt: null, timedOutAt: time.toISOString() },
    sourceOccurredAt: time, detectedAt: time, evaluatedAt: time, ...overrides });
}

/** Implements only this repository's SQL operations; atomic create/CAS emulate DB constraints. */
export class RiskTestStore {
  rows = new Map<string, OperationalRiskAssessment>();
  creates = 0;
  updates = 0;
  createError: unknown;
  readError: unknown;
  beforeUpdate?: () => Promise<void>;
  lastQuery?: Prisma.OperationalRiskAssessmentFindManyArgs;

  async create({ data }: { data: Prisma.OperationalRiskAssessmentUncheckedCreateInput }) {
    this.creates++;
    if (this.createError) throw this.createError;
    const duplicate = [...this.rows.values()].find(row => ["ruleCode", "ruleVersion", "entityType", "entityId", "occurrenceKey"].every(key => row[key as keyof typeof row] === data[key as keyof typeof data]));
    if (duplicate) throw { code: "P2002", meta: { target: ["ruleCode", "ruleVersion", "entityType", "entityId", "occurrenceKey"] } };
    const row = { ...structuredClone(data), id: randomUUID(), status: "OPEN", orderId: data.orderId ?? null, pharmacyId: data.pharmacyId ?? null,
      sourceOccurredAt: data.sourceOccurredAt ?? null, acknowledgedAt: null, acknowledgedByAdminId: null,
      resolvedAt: null, resolvedByAdminId: null, dismissedAt: null, dismissedByAdminId: null,
      resolutionReason: null, revision: 0, createdAt: new Date(time), updatedAt: new Date(time) } as OperationalRiskAssessment;
    this.rows.set(row.id, row);
    return structuredClone(row);
  }
  async findUnique({ where }: { where: Prisma.OperationalRiskAssessmentWhereUniqueInput }) {
    if (this.readError) throw this.readError;
    const row = where.id ? this.rows.get(where.id) : [...this.rows.values()].find(row => Object.entries(where.occurrence!).every(([key, value]) => row[key as keyof typeof row] === value));
    return row ? structuredClone(row) : null;
  }
  async updateMany({ where, data }: { where: Prisma.OperationalRiskAssessmentWhereInput; data: Prisma.OperationalRiskAssessmentUpdateManyMutationInput }) {
    if (this.beforeUpdate) { const hook = this.beforeUpdate; this.beforeUpdate = undefined; await hook(); }
    this.updates++;
    const row = this.rows.get(where.id as string);
    if (!row || row.revision !== where.revision || row.status !== where.status) return { count: 0 };
    const { revision: _revision, ...fields } = data;
    Object.assign(row, structuredClone(fields), { revision: row.revision + 1, updatedAt: new Date(later) });
    return { count: 1 };
  }
  async findMany(args: Prisma.OperationalRiskAssessmentFindManyArgs) {
    this.lastQuery = structuredClone(args);
    const where = args.where!;
    let rows = [...this.rows.values()].filter(row =>
      (!where.orderId || row.orderId === where.orderId) && (!where.severity || row.severity === where.severity) &&
      (!where.ruleCode || row.ruleCode === where.ruleCode) && (!where.status || (where.status as { in: string[] }).in.includes(row.status)));
    rows = rows.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime() || a.id.localeCompare(b.id));
    return structuredClone(rows.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? 25)));
  }
  repository() {
    // Generated Prisma delegates are generic PrismaPromises; this fake implements their used behavior.
    return new PrismaOperationalRiskRepository(this as unknown as PrismaClient["operationalRiskAssessment"]);
  }
}
