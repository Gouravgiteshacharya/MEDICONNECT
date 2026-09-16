import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OperationalRiskError } from "../src/risk/risk.types.js";
import { RiskTestStore, actorId, secondActorId, detection, entityId, orderId, time, later } from "./risk-test-store.js";

describe("operational risk repository", () => {
  it("creates and reads by ID and exact occurrence", async () => {
    const repo = new RiskTestStore().repository();
    const row = await repo.createOrGetOccurrence(detection());
    expect(await repo.getById(row.id)).toEqual(row);
    const { ruleCode, ruleVersion, entityType, entityId, occurrenceKey } = row;
    expect(await repo.getByOccurrence({ ruleCode, ruleVersion, entityType, entityId, occurrenceKey })).toEqual(row);
    expect(await repo.getById(actorId)).toBeNull();
  });
  it("repeated detection preserves ALL occurrence metadata and terminal state", async () => {
    const store = new RiskTestStore(); const repo = store.repository();
    const original = await repo.createOrGetOccurrence(detection());
    await repo.updateLifecycle({ id: original.id, expectedRevision: 0, expectedStatus: "OPEN", targetStatus: "DISMISSED", at: later, actorId, reason: "FALSE_POSITIVE" });
    const before = await repo.getById(original.id);
    const repeated = await repo.createOrGetOccurrence(detection({ severity: "HIGH", sourceOccurredAt: later, detectedAt: later, evaluatedAt: later, evidence: { assignmentStatus: "TIMED_OUT", offerExpiresAt: time.toISOString(), timedOutAt: later.toISOString() } }));
    expect(repeated).toEqual(before);
    expect(store.rows.size).toBe(1);
  });
  it("concurrent duplicate creates converge through the unique constraint", async () => {
    const store = new RiskTestStore(); const repo = store.repository();
    const rows = await Promise.all(Array.from({ length: 10 }, () => repo.createOrGetOccurrence(detection())));
    expect(new Set(rows.map(row => row.id)).size).toBe(1);
    expect(store.creates).toBe(10);
    expect(store.rows.size).toBe(1);
  });
  it("separates occurrence keys and rule versions", async () => {
    const store = new RiskTestStore(); const repo = store.repository();
    await repo.createOrGetOccurrence(detection());
    await repo.createOrGetOccurrence(detection({ occurrenceKey: "episode:2" }));
    await repo.createOrGetOccurrence(detection({ ruleVersion: "2" }));
    expect(store.rows.size).toBe(3);
  });
  it.each([{ code: "P2002", meta: { target: ["id"] } }, { code: "P2003", message: "private database info" }, new Error("private")])("sanitizes unrelated database errors %j", async error => {
    const store = new RiskTestStore(); store.createError = error;
    await expect(store.repository().createOrGetOccurrence(detection())).rejects.toEqual(new OperationalRiskError("PERSISTENCE_FAILED"));
  });
  it("handles a named occurrence conflict and fails safely if reload finds nothing", async () => {
    const store = new RiskTestStore(); const repo = store.repository();
    const original = await repo.createOrGetOccurrence(detection());
    store.createError = { code: "P2002", meta: { target: "operational_risk_occurrence_key" } };
    expect(await repo.createOrGetOccurrence(detection())).toEqual(original);
    store.rows.clear();
    await expect(repo.createOrGetOccurrence(detection())).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
  });
  it("sanitizes read errors", async () => {
    const store = new RiskTestStore(); store.readError = new Error("sensitive connection");
    await expect(store.repository().getById(entityId)).rejects.toEqual(new OperationalRiskError("PERSISTENCE_FAILED"));
  });
  it("reloads a lost CAS and preserves the winning resolution actor", async () => {
    const store = new RiskTestStore(); const repo = store.repository();
    const row = await repo.createOrGetOccurrence(detection());
    store.beforeUpdate = async () => { await repo.updateLifecycle({ id: row.id, expectedRevision: 0, expectedStatus: "OPEN", targetStatus: "RESOLVED", at: time, actorId: secondActorId, reason: "OPERATOR_RESOLVED" }); };
    const result = await repo.updateLifecycle({ id: row.id, expectedRevision: 0, expectedStatus: "OPEN", targetStatus: "RESOLVED", at: later, actorId, reason: "OPERATOR_RESOLVED" });
    expect(result.status).toBe("idempotent");
    expect(await repo.getById(row.id)).toMatchObject({ resolvedByAdminId: secondActorId, resolvedAt: time, revision: 1 });
  });
  it("concurrent acknowledge loses safely to resolve", async () => {
    const store = new RiskTestStore(); const repo = store.repository(); const row = await repo.createOrGetOccurrence(detection());
    store.beforeUpdate = async () => { await repo.updateLifecycle({ id: row.id, expectedRevision: 0, expectedStatus: "OPEN", targetStatus: "RESOLVED", at: later, actorId, reason: "OPERATOR_RESOLVED" }); };
    expect((await repo.updateLifecycle({ id: row.id, expectedRevision: 0, expectedStatus: "OPEN", targetStatus: "ACKNOWLEDGED", at: later, actorId })).status).toBe("conflict");
    expect(await repo.getById(row.id)).toMatchObject({ status: "RESOLVED", acknowledgedAt: null, revision: 1 });
  });
  it("stale resolve cannot bypass a concurrent acknowledgement", async () => {
    const store = new RiskTestStore(); const repo = store.repository(); const row = await repo.createOrGetOccurrence(detection());
    store.beforeUpdate = async () => { await repo.updateLifecycle({ id: row.id, expectedRevision: 0, expectedStatus: "OPEN", targetStatus: "ACKNOWLEDGED", at: later, actorId }); };
    expect((await repo.updateLifecycle({ id: row.id, expectedRevision: 0, expectedStatus: "OPEN", targetStatus: "RESOLVED", at: later, actorId, reason: "OPERATOR_RESOLVED" })).status).toBe("conflict");
    expect(await repo.getById(row.id)).toMatchObject({ status: "ACKNOWLEDGED", resolvedAt: null });
  });
  it("filters and orders query results deterministically with pagination", async () => {
    const store = new RiskTestStore(); const repo = store.repository();
    const a = await repo.createOrGetOccurrence(detection());
    const b = await repo.createOrGetOccurrence(detection({ occurrenceKey: "b", severity: "HIGH" }));
    const c = await repo.createOrGetOccurrence(detection({ occurrenceKey: "c", orderId: secondActorId, detectedAt: later, evaluatedAt: later }));
    await repo.updateLifecycle({ id: b.id, expectedRevision: 0, expectedStatus: "OPEN", targetStatus: "ACKNOWLEDGED", actorId, at: later });
    expect((await repo.listOpen()).map(row => row.id)).toEqual([c.id, ...[a.id, b.id].sort()]);
    expect(store.lastQuery?.orderBy).toEqual([{ detectedAt: "desc" }, { id: "asc" }]);
    expect((await repo.listByOrder(orderId)).map(row => row.id)).toEqual([a.id, b.id].sort());
    expect((await repo.listOpen({ severity: "HIGH", ruleCode: "ASSIGNMENT_OFFER_TIMED_OUT" })).map(row => row.id)).toEqual([b.id]);
    expect((await repo.listOpen({ offset: 1, limit: 1 })).map(row => row.id)).toEqual([[a.id, b.id].sort()[0]]);
    expect(await repo.listOpen({ ruleCode: "OTHER_RULE" })).toEqual([]);
    await repo.updateLifecycle({ id: b.id, expectedRevision: 1, expectedStatus: "ACKNOWLEDGED", targetStatus: "RESOLVED", actorId, at: later, reason: "OPERATOR_RESOLVED" });
    await repo.updateLifecycle({ id: a.id, expectedRevision: 0, expectedStatus: "OPEN", targetStatus: "DISMISSED", actorId, at: later, reason: "FALSE_POSITIVE" });
    expect((await repo.listOpen()).map(row => row.id)).toEqual([c.id]);
    expect(await repo.listByOrder(orderId)).toHaveLength(2);
  });
  it.each([{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 1.5 }, { offset: 1_000_001 }, { limit: NaN }])("rejects invalid pagination %j", async page => {
    const repo = new RiskTestStore().repository();
    await expect(repo.listOpen(page)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(repo.listByOrder(orderId, page)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("detaches input and output objects and never mutates another record", async () => {
    const repo = new RiskTestStore().repository(); const input = detection();
    const a = await repo.createOrGetOccurrence(input);
    const b = await repo.createOrGetOccurrence(detection({ occurrenceKey: "b" }));
    input.detectedAt.setUTCFullYear(2000); a.detectedAt.setUTCFullYear(1990);
    Object.assign(a.evidence, { phone: "forbidden" });
    expect((await repo.getById(a.id))?.detectedAt.getUTCFullYear()).toBe(2026);
    expect((await repo.getById(a.id))?.evidence).not.toHaveProperty("phone");
    await repo.updateLifecycle({ id: a.id, expectedRevision: 0, expectedStatus: "OPEN", targetStatus: "ACKNOWLEDGED", at: later, actorId });
    expect(await repo.getById(b.id)).toEqual(b);
  });
  it("validates direct repository detections before any store call", async () => {
    const store = new RiskTestStore();
    await expect(store.repository().createOrGetOccurrence(detection({ entityId: "bad" }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(store.creates).toBe(0);
  });
});

describe("operational risk schema and additive migration", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../prisma/migrations/20260914000000_operational_risk_assessments/migration.sql", import.meta.url), "utf8");
  it("leaves the legacy RiskAssessment model byte-equivalent after newline normalization", () => {
    const legacy = schema.replace(/\r\n/g, "\n").match(/model RiskAssessment \{[^}]+\}/)![0];
    // Captured from the clean pre-13A schema, not from the new operational model.
    expect(createHash("sha256").update(legacy).digest("hex")).toBe("7cae434090140b5b74bc4357a6dd5356cd0874fc73c09cca92b55a2f1167883c");
  });
  it.each([
    ["OperationalRiskEntityType", ["ORDER", "DELIVERY_ASSIGNMENT", "PRESCRIPTION", "PHARMACY_INVENTORY"]],
    ["OperationalRiskSeverity", ["INFO", "LOW", "MEDIUM", "HIGH"]],
    ["OperationalRiskStatus", ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]],
    ["OperationalRiskResolutionPolicy", ["AUTO_RESOLVABLE", "MANUAL_RESOLUTION", "HISTORICAL_EVENT_ONLY"]],
  ])("has exact %s enum", (name, values) => {
    expect(schema.match(new RegExp(`enum ${name} \\{([^}]+)\\}`))?.[1].trim().split(/\s+/)).toEqual(values);
    expect(migration).toContain(`CREATE TYPE "${name}" AS ENUM (${(values as string[]).map(value => `'${value}'`).join(", ")})`);
  });
  it("creates only the new table, with exact occurrence uniqueness and no backfill/destruction", () => {
    expect(migration.match(/CREATE TABLE /g)).toHaveLength(1);
    expect(migration).toContain('CREATE TABLE "OperationalRiskAssessment"');
    expect(migration).toContain('CREATE UNIQUE INDEX "operational_risk_occurrence_key" ON "OperationalRiskAssessment"("ruleCode", "ruleVersion", "entityType", "entityId", "occurrenceKey")');
    expect(migration).not.toMatch(/^\s*(DROP|DELETE|INSERT|TRUNCATE|RENAME)\b|ALTER TABLE "(?!OperationalRiskAssessment")/m);
    expect(migration).not.toContain('"RiskAssessment"');
    expect(migration).not.toMatch(/\bUPDATE\s+"/);
  });
  it("retains nullable actors and restrictive foreign keys without polymorphic FK", () => {
    for (const field of ["acknowledgedByAdminId", "resolvedByAdminId", "dismissedByAdminId"]) expect(migration).toContain(`"${field}" UUID,`);
    expect(migration.match(/ON DELETE RESTRICT/g)).toHaveLength(5);
    expect(migration).not.toContain('FOREIGN KEY ("entityId")');
    expect(migration).toContain('"revision" INTEGER NOT NULL DEFAULT 0');
  });
  it("includes the five queue/history indexes", () => {
    for (const fields of [['status','severity','detectedAt'], ['entityType','entityId','detectedAt'], ['orderId','detectedAt'], ['pharmacyId','detectedAt'], ['ruleCode','status']]) {
      expect(migration).toContain(`ON "OperationalRiskAssessment"(${fields.map(field => `"${field}"`).join(', ')})`);
    }
  });
});
