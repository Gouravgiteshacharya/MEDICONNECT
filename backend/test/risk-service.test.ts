import { describe, expect, it } from "vitest";
import { OperationalRiskService } from "../src/risk/risk.service.js";
import { validateRiskEvidence, riskCode, parseRiskInput } from "../src/risk/risk.evidence.js";
import type { OperationalRiskDetection, OperationalRiskStatus, RiskLifecycleInput } from "../src/risk/risk.types.js";
import { RiskTestStore, actorId, secondActorId, detection, entityId, time, later, orderId } from "./risk-test-store.js";

function setup() { const store = new RiskTestStore(); const service = new OperationalRiskService(store.repository()); return { store, service }; }
const failure = detection({ ruleCode: "DELIVERY_FAILED", severity: "HIGH", resolutionPolicy: "MANUAL_RESOLUTION", evidence: { assignmentStatus: "FAILED", eventType: "FAILED_DELIVERY", occurredAt: time.toISOString(), orderStatusAtFailure: "OUT_FOR_DELIVERY", requiresManualReview: true } });
const stale = detection({ ruleCode: "RIDER_LOCATION_STALE", severity: "LOW", resolutionPolicy: "AUTO_RESOLVABLE", evidence: { assignmentStatus: "ACCEPTED", locationFreshness: "STALE", lastLocationAt: time.toISOString(), freshnessThresholdMs: 60000, evaluatedAt: later.toISOString() }, detectedAt: later, evaluatedAt: later });

describe("risk detection contracts", () => {
  it.each([detection(), failure, stale])("records allowlisted $ruleCode evidence", async input => {
    const { service } = setup(); const row = await service.recordDetection(input);
    expect(row.evidence).toEqual(input.evidence);
    expect(row.status).toBe("OPEN"); expect(row.revision).toBe(0);
  });
  it("validates stable codes without restricting the format validator to three names", () => {
    expect(parseRiskInput(riskCode, "FUTURE_OPERATIONAL_RULE_2")).toBe("FUTURE_OPERATIONAL_RULE_2");
  });
  it.each([
    ["ruleCode", ""], ["ruleCode", "bad code"], ["ruleCode", " lowercase"], ["ruleCode", " A"],
    ["ruleVersion", ""], ["ruleVersion", "v1"], ["ruleVersion", " 1"], ["ruleVersion", "0"], ["ruleVersion", "1.0"],
    ["entityId", "not-a-uuid"], ["orderId", "bad"], ["pharmacyId", "bad"],
    ["occurrenceKey", ""], ["occurrenceKey", " "], ["occurrenceKey", "email@example.com"], ["occurrenceKey", "a".repeat(201)],
    ["evidenceSchemaVersion", 0], ["evidenceSchemaVersion", 2], ["evidenceSchemaVersion", 1.5],
    ["ruleCode", "FUTURE_RULE"], ["entityType", "RIDER"], ["entityType", "CUSTOMER"], ["severity", "CRITICAL"],
    ["resolutionPolicy", "UNKNOWN"], ["detectedAt", new Date(NaN)], ["evaluatedAt", "2026-09-14"],
    ["sourceOccurredAt", later], ["evaluatedAt", new Date("2000-01-01")],
  ])("rejects invalid %s=%s before persistence", async (key, value) => {
    const { service, store } = setup();
    await expect(service.recordDetection({ ...detection(), [key as string]: value } as OperationalRiskDetection)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(store.creates).toBe(0);
  });
  it.each(["name", "email", "phone", "address", "latitude", "longitude", "medicine", "medicineName", "prescriptionFile", "prescriptionContent", "supportMessage", "message", "failureNote", "note", "riderId", "orderNumber", "customer", "riskScore", "probability", "modelVersion"])('rejects broad evidence containing "%s" for every schema', async key => {
    const { service, store } = setup();
    for (const input of [detection(), failure, stale]) {
      await expect(service.recordDetection({ ...input, evidence: { ...input.evidence, [key]: "private" } } as OperationalRiskDetection)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(store.creates).toBe(0);
  });
  it.each([undefined, null, "failure narrative", [], new Date(), () => 1, Symbol("private"), { assignmentStatus: "TIMED_OUT" }])("rejects unsupported evidence %s", async evidence => {
    const { service } = setup();
    await expect(service.recordDetection({ ...detection(), evidence } as OperationalRiskDetection)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("accepts zero freshness threshold evidence", async () => {
    const { service } = setup();
    const evidence = { ...stale.evidence, freshnessThresholdMs: 0 };
    expect(validateRiskEvidence("RIDER_LOCATION_STALE", 1, evidence)).toEqual(evidence);
    expect((await service.recordDetection({ ...stale, evidence })).evidence).toEqual(evidence);
  });
  it.each([NaN, Infinity, -Infinity, undefined, () => 1, Symbol("x"), -1])("rejects invalid numeric evidence %s", async value => {
    const { service } = setup();
    await expect(service.recordDetection({ ...stale, evidence: { ...stale.evidence, freshnessThresholdMs: value } } as OperationalRiskDetection)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it.each([new Date(time), "2026-02-30T00:00:00.000Z", "2026-09-14", undefined])("rejects noncanonical evidence timestamps %s", async value => {
    const { service } = setup();
    await expect(service.recordDetection({ ...detection(), evidence: { ...detection().evidence, timedOutAt: value } } as OperationalRiskDetection)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("rejects wrong rule evidence and arbitrary text in permitted fields", async () => {
    const { service } = setup();
    await expect(service.recordDetection({ ...failure, evidence: detection().evidence })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.recordDetection({ ...failure, evidence: { ...failure.evidence, orderStatusAtFailure: "private failure narrative" } } as unknown as OperationalRiskDetection)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.recordDetection({ ...stale, evidence: { ...stale.evidence, assignmentStatus: "DELIVERED" } } as unknown as OperationalRiskDetection)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("rejects extra top-level data", async () => {
    const { service } = setup();
    await expect(service.recordDetection({ ...detection(), riskScore: 50 } as OperationalRiskDetection)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("rejects hidden/symbol fields, accessors and custom prototypes", () => {
    const examples = [Object.defineProperty({ ...detection().evidence }, "phone", { value: "private" }), { ...detection().evidence, [Symbol("secret")]: "private" }, Object.create(detection().evidence), Object.defineProperty({ ...detection().evidence }, "timedOutAt", { get() { throw new Error("must not invoke"); }, enumerable: true })];
    for (const evidence of examples) expect(() => validateRiskEvidence("ASSIGNMENT_OFFER_TIMED_OUT", 1, evidence)).toThrow("Invalid operational risk input");
  });
  it("enforces entity/link shape without hydrating domain rows", async () => {
    const { service } = setup();
    await expect(service.recordDetection(detection({ entityType: "ORDER", orderId }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.recordDetection(detection({ entityType: "PHARMACY_INVENTORY" }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.recordDetection(detection({ entityType: "PRESCRIPTION" }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await service.recordDetection(detection({ orderId: null, pharmacyId: null }))).toMatchObject({ entityId, orderId: null, pharmacyId: null });
  });
  it("normalizes UUID casing and keeps versioning independent", async () => {
    const { service } = setup();
    expect(await service.recordDetection(detection({ entityId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", ruleVersion: "2" }))).toMatchObject({ entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ruleVersion: "2", evidenceSchemaVersion: 1 });
  });
  it("returns the same record on repeated detection and exposes internal reads only", async () => {
    const { service } = setup(); const row = await service.recordDetection(detection());
    expect(await service.recordDetection(detection())).toEqual(row);
    expect(await service.getById(row.id)).toEqual(row);
    expect(await service.listByOrder(orderId)).toEqual([row]);
    expect(await service.listOpen()).toEqual([row]);
  });
});

describe("risk lifecycle service", () => {
  async function starting(status: OperationalRiskStatus, policy: OperationalRiskDetection["resolutionPolicy"] = "MANUAL_RESOLUTION") {
    const context = setup(); const row = await context.service.recordDetection(detection({ resolutionPolicy: policy }));
    const command = { id: row.id, expectedRevision: 0, actorId, at: time };
    if (status === "ACKNOWLEDGED") await context.service.acknowledgeAssessment(command);
    if (status === "RESOLVED") await context.service.resolveAssessment({ ...command, reason: "OPERATOR_RESOLVED" });
    if (status === "DISMISSED") await context.service.dismissAssessment({ ...command, reason: "FALSE_POSITIVE" });
    return { ...context, row: (await context.service.getById(row.id))! };
  }
  it.each(["OPEN", "ACKNOWLEDGED"] as const)("acknowledges %s with stable actor/time", async status => {
    const { service, row } = await starting(status);
    const result = await service.acknowledgeAssessment({ id: row.id, expectedRevision: row.revision, actorId: secondActorId, at: later });
    expect(result.status).toBe(status === "OPEN" ? "updated" : "idempotent");
    expect(await service.getById(row.id)).toMatchObject({ status: "ACKNOWLEDGED", acknowledgedByAdminId: status === "OPEN" ? secondActorId : actorId, acknowledgedAt: status === "OPEN" ? later : time, revision: 1 });
  });
  it.each(["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const)("resolves %s with stable actor/time", async status => {
    const { service, row } = await starting(status);
    const result = await service.resolveAssessment({ id: row.id, expectedRevision: row.revision, actorId: secondActorId, at: later, reason: "OPERATOR_RESOLVED" });
    expect(result.status).toBe(status === "RESOLVED" ? "idempotent" : "updated");
    const current = await service.getById(row.id);
    expect(current).toMatchObject({ status: "RESOLVED", resolvedByAdminId: status === "RESOLVED" ? actorId : secondActorId, resolvedAt: status === "RESOLVED" ? time : later });
    expect(current?.acknowledgedAt).toEqual(row.acknowledgedAt);
  });
  it.each(["OPEN", "ACKNOWLEDGED", "DISMISSED"] as const)("dismisses %s with stable actor/time/reason", async status => {
    const { service, row } = await starting(status);
    const result = await service.dismissAssessment({ id: row.id, expectedRevision: row.revision, actorId: secondActorId, at: later, reason: "DUPLICATE_CONTEXT" });
    expect(result.status).toBe(status === "DISMISSED" ? "idempotent" : "updated");
    expect(await service.getById(row.id)).toMatchObject({ status: "DISMISSED", dismissedByAdminId: status === "DISMISSED" ? actorId : secondActorId, dismissedAt: status === "DISMISSED" ? time : later, resolutionReason: status === "DISMISSED" ? "FALSE_POSITIVE" : "DUPLICATE_CONTEXT" });
  });
  it.each([
    ["RESOLVED", "acknowledgeAssessment"], ["DISMISSED", "acknowledgeAssessment"], ["DISMISSED", "resolveAssessment"], ["RESOLVED", "dismissAssessment"],
  ] as const)("rejects %s -> %s", async (status, method) => {
    const { service, row } = await starting(status);
    const reason = method === "resolveAssessment" ? "OPERATOR_RESOLVED" : method === "dismissAssessment" ? "FALSE_POSITIVE" : undefined;
    expect((await service[method]({ id: row.id, expectedRevision: row.revision, actorId, at: later, ...(reason ? { reason } : {}) })).status).toBe("conflict");
    expect(await service.getById(row.id)).toEqual(row);
  });
  it("automatically resolves only an auto-resolvable occurrence with null actor", async () => {
    const { service, row } = await starting("OPEN", "AUTO_RESOLVABLE");
    expect((await service.resolveAssessment({ id: row.id, expectedRevision: 0, actorId: null, at: later, reason: "CONDITION_CLEARED" })).status).toBe("updated");
    expect(await service.getById(row.id)).toMatchObject({ resolvedByAdminId: null, resolvedAt: later, resolutionReason: "CONDITION_CLEARED" });
  });
  it.each(["MANUAL_RESOLUTION", "HISTORICAL_EVENT_ONLY"] as const)("does not auto-resolve %s", async policy => {
    const { service, row } = await starting("OPEN", policy);
    expect((await service.resolveAssessment({ id: row.id, expectedRevision: 0, actorId: null, at: later, reason: "CONDITION_CLEARED" })).status).toBe("conflict");
    expect(await service.getById(row.id)).toEqual(row);
  });
  it("rejects stale revisions and older action timestamps", async () => {
    const { service, row } = await starting("ACKNOWLEDGED");
    expect((await service.resolveAssessment({ id: row.id, expectedRevision: 0, actorId, at: later, reason: "OPERATOR_RESOLVED" })).status).toBe("conflict");
    expect((await service.resolveAssessment({ id: row.id, expectedRevision: 1, actorId, at: new Date("2000-01-01"), reason: "OPERATOR_RESOLVED" })).status).toBe("conflict");
    expect(await service.getById(row.id)).toEqual(row);
  });
  it.each([
    { actorId: "bad" }, { actorId: null }, { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: 2147483647 }, { at: new Date(NaN) }, { reason: "private notes here" },
  ])("rejects invalid acknowledgement %j", async fields => {
    const { service, row } = await starting("OPEN");
    await expect(service.acknowledgeAssessment({ id: row.id, expectedRevision: 0, actorId, at: later, ...fields } as RiskLifecycleInput)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await service.getById(row.id)).toEqual(row);
  });
  it("rejects invalid reasons and untrusted absent actors", async () => {
    const { service, row } = await starting("OPEN"); const input = { id: row.id, expectedRevision: 0, at: later, actorId };
    await expect(service.resolveAssessment({ ...input, reason: "FALSE_POSITIVE" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.resolveAssessment({ ...input, reason: "patient is unwell" } as unknown as RiskLifecycleInput)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.dismissAssessment({ ...input, reason: "FALSE_POSITIVE", actorId: null })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.resolveAssessment({ ...input, reason: "OPERATOR_RESOLVED", actorId: null })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("returns typed not_found for all lifecycle actions", async () => {
    const { service } = setup(); const input = { id: entityId, expectedRevision: 0, at: later, actorId };
    expect(await service.acknowledgeAssessment(input)).toEqual({ status: "not_found" });
    expect(await service.resolveAssessment({ ...input, reason: "OPERATOR_RESOLVED" })).toEqual({ status: "not_found" });
    expect(await service.dismissAssessment({ ...input, reason: "FALSE_POSITIVE" })).toEqual({ status: "not_found" });
  });
});
