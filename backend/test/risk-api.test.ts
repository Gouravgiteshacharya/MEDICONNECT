import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { OperationalRiskService } from "../src/risk/risk.service.js";
import { parseRiskAssessmentId, parseRiskDismissBody, parseRiskListQuery, parseRiskResolveBody, requireEmptyRiskBody } from "../src/risk/risk.validation.js";
import { ApiError } from "../src/utils/ApiError.js";
import { RiskTestStore, detection, actorId, secondActorId, later, time } from "./risk-test-store.js";

const base = "/api/v1/admin/risk-assessments";
const authenticate: RequestHandler = (req, _res, next) => {
  const token = req.header("authorization")?.replace("Bearer ", "");
  if (token === "ADMIN" || token === "ADMIN2") req.user = { id: token === "ADMIN" ? actorId : secondActorId, role: "ADMIN" };
  if (token === "CUSTOMER" || token === "PHARMACY_STAFF" || token === "DELIVERY_PARTNER") req.user = { id: actorId, role: token };
  next();
};
function setup() {
  const store = new RiskTestStore(); const service = new OperationalRiskService(store.repository());
  const app = createApp({ riskService: service, authenticate, now: () => new Date(later) });
  return { store, service, app };
}
const get = (app: ReturnType<typeof createApp>, path = base, role = "ADMIN") => request(app).get(path).set("Authorization", `Bearer ${role}`);
const post = (app: ReturnType<typeof createApp>, id: string, action: string, body?: unknown, role = "ADMIN") => {
  const req = request(app).post(`${base}/${id}/${action}`).set("Authorization", `Bearer ${role}`);
  return body === undefined ? req : req.send(body as object);
};
const summaryKeys = ["id", "ruleCode", "ruleVersion", "entityType", "severity", "status", "resolutionPolicy", "detectedAt", "lastEvaluatedAt", "acknowledgedAt", "resolvedAt", "dismissedAt", "resolutionReasonCode", "revision"].sort();

describe("admin risk request validation", () => {
  it("defaults and valid filters preserve repository pagination", () => {
    expect(parseRiskListQuery({})).toEqual({ limit: 25, offset: 0 });
    expect(parseRiskListQuery({ severity: "HIGH", ruleCode: "DELIVERY_FAILED", limit: "100", offset: "1000000" })).toEqual({ severity: "HIGH", ruleCode: "DELIVERY_FAILED", limit: 100, offset: 1000000 });
  });
  it.each([{ offset: "-1" }, { offset: "1.5" }, { offset: "1e3" }, { offset: "1000001" }, { offset: "" }, { limit: "0" }, { limit: "101" }, { limit: "01" }, { limit: "25 " }, { limit: "NaN" }, { limit: ["1", "2"] }, { severity: "CRITICAL" }, { ruleCode: "free text" }, { status: "RESOLVED" }, { role: "ADMIN" }, { search: "private" }])("rejects malformed/unsupported query %j", query => {
    expect(() => parseRiskListQuery(query)).toThrow(ApiError);
  });
  it("validates UUIDs without accepting arbitrary IDs", () => {
    expect(parseRiskAssessmentId(actorId.toUpperCase())).toBe(actorId);
    expect(() => parseRiskAssessmentId("bad-id")).toThrow(ApiError);
  });
  it("accepts only documented reason bodies and empty acknowledgement", () => {
    expect(parseRiskResolveBody({ reason: "OPERATOR_RESOLVED" }).reason).toBe("OPERATOR_RESOLVED");
    for (const reason of ["FALSE_POSITIVE", "DUPLICATE_CONTEXT"]) expect(parseRiskDismissBody({ reason }).reason).toBe(reason);
    expect(() => requireEmptyRiskBody(undefined)).not.toThrow(); expect(() => requireEmptyRiskBody({})).not.toThrow();
  });
  it.each([{ reason: "CONDITION_CLEARED" }, { reason: "free text" }, { reason: "OPERATOR_RESOLVED", actorId }, { reason: "OPERATOR_RESOLVED", revision: 3 }, {}])("rejects resolve body %j", body => {
    expect(() => parseRiskResolveBody(body)).toThrow(ApiError);
  });
  it.each([{ reason: "OPERATOR_RESOLVED" }, { reason: "private notes" }, { reason: "FALSE_POSITIVE", dismissedById: actorId }, []])("rejects dismiss body %j", body => {
    expect(() => parseRiskDismissBody(body)).toThrow(ApiError);
  });
});

describe("admin risk authorization and optional dependencies", () => {
  it.each(["", "CUSTOMER", "PHARMACY_STAFF", "DELIVERY_PARTNER"])("rejects %s on every route without querying risk storage", async role => {
    const { app, service } = setup(); const reads = vi.spyOn(service, "listAdminOpen"); const detail = vi.spyOn(service, "getAdminById"); const strict = vi.spyOn(service, "getById");
    const expected = role ? 403 : 401;
    expect((await get(app, base, role)).status).toBe(expected);
    expect((await get(app, `${base}/${actorId}`, role)).status).toBe(expected);
    for (const action of ["acknowledge", "resolve", "dismiss"]) expect((await post(app, actorId, action, {}, role)).status).toBe(expected);
    expect(reads).not.toHaveBeenCalled(); expect(detail).not.toHaveBeenCalled(); expect(strict).not.toHaveBeenCalled();
  });
  it("allows ADMIN and returns 503 only to authorized admins if service is absent", async () => {
    const { app } = setup(); expect((await get(app)).status).toBe(200);
    const disabled = createApp({ authenticate });
    expect((await get(disabled)).status).toBe(503); expect((await get(disabled, base, "CUSTOMER")).status).toBe(403);
    expect((await post(disabled, actorId, "acknowledge")).status).toBe(503);
  });
  it("production authentication still rejects missing credentials", async () => {
    expect((await request(createApp({})).get(base)).status).toBe(401);
  });
  it("exposes no create endpoint or caller-controlled roles", async () => {
    const { app } = setup(); expect((await request(app).post(base).set("Authorization", "Bearer ADMIN").send({})).status).toBe(404);
    expect((await get(app, `${base}?role=ADMIN`, "CUSTOMER")).status).toBe(403);
  });
});

describe("admin risk queue and detail", () => {
  it("returns only OPEN/ACKNOWLEDGED, deterministic ordering and explicit summary fields", async () => {
    const { app, service, store } = setup();
    const a = await service.recordDetection(detection({ occurrenceKey: "a" }));
    const b = await service.recordDetection(detection({ occurrenceKey: "b", severity: "HIGH" }));
    const c = await service.recordDetection(detection({ occurrenceKey: "c", detectedAt: later, evaluatedAt: later }));
    const closed = await service.recordDetection(detection({ occurrenceKey: "closed" }));
    const dismissed = await service.recordDetection(detection({ occurrenceKey: "dismissed" }));
    await service.acknowledgeAssessment({ id: b.id, expectedRevision: 0, actorId, at: later });
    await service.resolveAssessment({ id: closed.id, expectedRevision: 0, actorId, at: later, reason: "OPERATOR_RESOLVED" });
    await service.dismissAssessment({ id: dismissed.id, expectedRevision: 0, actorId, at: later, reason: "FALSE_POSITIVE" });
    const response = await get(app); expect(response.status).toBe(200);
    expect(response.body.data.map((r: { id: string }) => r.id)).toEqual([c.id, ...[a.id, b.id].sort()]);
    expect(response.body.pagination).toEqual({ limit: 25, offset: 0 });
    for (const row of response.body.data) expect(Object.keys(row).sort()).toEqual(summaryKeys);
    expect(store.lastQuery?.select).not.toHaveProperty("evidence");
    expect((await get(app, `${base}?severity=HIGH&ruleCode=ASSIGNMENT_OFFER_TIMED_OUT`)).body.data.map((r: { id: string }) => r.id)).toEqual([b.id]);
    expect((await get(app, `${base}?limit=1&offset=1`)).body.data[0].id).toBe([a.id, b.id].sort()[0]);
    expect((await get(app, `${base}?ruleCode=DELIVERY_FAILED`)).body.data).toEqual([]);
  });
  it.each([
    detection(),
    detection({ ruleCode: "DELIVERY_FAILED", evidence: { assignmentStatus: "FAILED", eventType: "FAILED_DELIVERY", occurredAt: time.toISOString(), orderStatusAtFailure: "OUT_FOR_DELIVERY", requiresManualReview: true } }),
    detection({ ruleCode: "RIDER_LOCATION_STALE", evidence: { assignmentStatus: "ACCEPTED", locationFreshness: "STALE", lastLocationAt: time.toISOString(), freshnessThresholdMs: 0, evaluatedAt: later.toISOString() } }),
  ])("projects only registered $ruleCode detail evidence", async input => {
    const { app, service, store } = setup(); const record = await service.recordDetection(input); const before = structuredClone([...store.rows.values()]);
    const response = await get(app, `${base}/${record.id}`); expect(response.status).toBe(200);
    expect(Object.keys(response.body.data).sort()).toEqual([...summaryKeys, "evidence"].sort());
    expect(response.body.data.evidence).toEqual({ status: "available", evidence: input.evidence });
    expect([...store.rows.values()]).toEqual(before); expect(store.updates).toBe(0);
  });
  it.each(["name", "email", "phone", "address", "latitude", "longitude", "medicine", "prescription", "note", "failureNote", "supportMessage", "customerId", "riderId"])("redacts forbidden stored %s and never leaks sentinel in detail/queue", async key => {
    const { app, service, store } = setup(); const record = await service.recordDetection(detection());
    store.rows.get(record.id)!.evidence = { ...record.evidence, [key]: "FORBIDDEN_SENTINEL_42" };
    const detail = await get(app, `${base}/${record.id}`); const list = await get(app);
    expect(detail.status).toBe(200); expect(detail.body.data.evidence).toEqual({ status: "unavailable", reason: "invalid_evidence" });
    expect(list.body.data).toHaveLength(1); expect(list.body.data[0]).not.toHaveProperty("evidence");
    expect(JSON.stringify([detail.body, list.body])).not.toContain("FORBIDDEN_SENTINEL_42"); expect(store.updates).toBe(0);
  });
  it("unknown stored rule returns metadata with redacted evidence and remains in queue", async () => {
    const { app, service, store } = setup(); const row = await service.recordDetection(detection());
    store.rows.get(row.id)!.ruleCode = "RETIRED_RULE"; store.rows.get(row.id)!.evidence = { note: "FORBIDDEN_SENTINEL_42" };
    const detail = await get(app, `${base}/${row.id}`); expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ ruleCode: "RETIRED_RULE", evidence: { status: "unavailable", reason: "unknown_rule" } });
    const list = await get(app); expect(list.body.data).toHaveLength(1); expect(JSON.stringify([detail.body, list.body])).not.toContain("FORBIDDEN_SENTINEL_42");
  });
  it("missing UUID is 404; malformed IDs and filters are 400", async () => {
    const { app } = setup(); expect((await get(app, `${base}/${actorId}`)).status).toBe(404);
    expect((await get(app, `${base}/bad`)).status).toBe(400); expect((await get(app, `${base}?limit=-1`)).status).toBe(400);
    expect((await get(app, `${base}?limit=1&limit=2`)).status).toBe(400);
  });
});

describe("admin risk lifecycle translation", () => {
  it("acknowledges without a body using auth identity; repeat preserves original actor/time", async () => {
    const { app, service, store } = setup(); const row = await service.recordDetection(detection());
    const first = await post(app, row.id, "acknowledge"); expect(first.status).toBe(200); expect(first.body.data.status).toBe("ACKNOWLEDGED");
    const saved = structuredClone(store.rows.get(row.id));
    const repeat = await post(app, row.id, "acknowledge", {}, "ADMIN2"); expect(repeat.body).toEqual(first.body);
    expect(store.rows.get(row.id)).toEqual(saved); expect(saved?.acknowledgedByAdminId).toBe(actorId);
  });
  it.each([false, true])("resolves open/acknowledged=%s with human reason and trusted actor", async acknowledged => {
    const { app, service, store } = setup(); const row = await service.recordDetection(detection());
    if (acknowledged) await post(app, row.id, "acknowledge");
    const result = await post(app, row.id, "resolve", { reason: "OPERATOR_RESOLVED" }); expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ status: "RESOLVED", resolutionReasonCode: "OPERATOR_RESOLVED" });
    const saved = structuredClone(store.rows.get(row.id)); expect(saved?.resolvedByAdminId).toBe(actorId);
    expect((await post(app, row.id, "resolve", { reason: "OPERATOR_RESOLVED" }, "ADMIN2")).body).toEqual(result.body);
    expect(store.rows.get(row.id)).toEqual(saved);
  });
  it.each(["FALSE_POSITIVE", "DUPLICATE_CONTEXT"])("dismisses with %s and preserves original metadata", async reason => {
    const { app, service, store } = setup(); const row = await service.recordDetection(detection());
    if (reason === "DUPLICATE_CONTEXT") await post(app, row.id, "acknowledge");
    const result = await post(app, row.id, "dismiss", { reason }); expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ status: "DISMISSED", resolutionReasonCode: reason });
    const saved = structuredClone(store.rows.get(row.id)); expect(saved?.dismissedByAdminId).toBe(actorId);
    expect((await post(app, row.id, "dismiss", { reason }, "ADMIN2")).body).toEqual(result.body); expect(store.rows.get(row.id)).toEqual(saved);
  });
  it.each(["resolve", "dismiss"])("incompatible terminal transitions after %s return conflict", async terminal => {
    const { app, service } = setup(); const row = await service.recordDetection(detection());
    await post(app, row.id, terminal, { reason: terminal === "resolve" ? "OPERATOR_RESOLVED" : "FALSE_POSITIVE" });
    expect((await post(app, row.id, "acknowledge")).status).toBe(409);
    expect((await post(app, row.id, terminal === "resolve" ? "dismiss" : "resolve", { reason: terminal === "resolve" ? "FALSE_POSITIVE" : "OPERATOR_RESOLVED" })).status).toBe(409);
  });
  it.each(["acknowledge", "resolve", "dismiss"])("%s rejects spoofed actors and unknown/malformed IDs", async action => {
    const { app, service, store } = setup(); const row = await service.recordDetection(detection());
    const body = action === "resolve" ? { reason: "OPERATOR_RESOLVED" } : action === "dismiss" ? { reason: "FALSE_POSITIVE" } : {};
    expect((await post(app, row.id, action, { ...body, actorId: secondActorId })).status).toBe(400);
    expect((await post(app, row.id, action, { ...body, resolvedById: secondActorId })).status).toBe(400);
    expect((await post(app, "bad", action, body)).status).toBe(400); expect((await post(app, actorId, action, body)).status).toBe(404);
    expect(store.updates).toBe(0);
  });
  it("does not expose automatic recovery or free-text reasons", async () => {
    const { app, service, store } = setup(); const row = await service.recordDetection(detection());
    expect((await post(app, row.id, "resolve", { reason: "CONDITION_CLEARED" })).status).toBe(400);
    expect((await post(app, row.id, "dismiss", { reason: "private narrative" })).status).toBe(400); expect(store.updates).toBe(0);
  });
  it("concurrent acknowledge vs resolve uses CAS without replacing the winner", async () => {
    const { app, service, store } = setup(); const row = await service.recordDetection(detection());
    store.beforeUpdate = async () => { expect((await post(app, row.id, "resolve", { reason: "OPERATOR_RESOLVED" }, "ADMIN2")).status).toBe(200); };
    const loser = await post(app, row.id, "acknowledge"); expect(loser.status).toBe(409);
    expect(store.rows.get(row.id)).toMatchObject({ status: "RESOLVED", resolvedByAdminId: secondActorId, acknowledgedAt: null, revision: 1 });
  });
  it("concurrent resolve vs dismiss preserves terminal winner and its actor", async () => {
    const { app, service, store } = setup(); const row = await service.recordDetection(detection());
    store.beforeUpdate = async () => { expect((await post(app, row.id, "dismiss", { reason: "FALSE_POSITIVE" }, "ADMIN2")).status).toBe(200); };
    expect((await post(app, row.id, "resolve", { reason: "OPERATOR_RESOLVED" })).status).toBe(409);
    expect(store.rows.get(row.id)).toMatchObject({ status: "DISMISSED", dismissedByAdminId: secondActorId, resolvedAt: null, revision: 1 });
  });
});

describe("admin risk failure sanitization", () => {
  it("repository read failures are sanitized with no raw exception logging", async () => {
    const { app, store } = setup(); store.readError = new Error("DATABASE_SECRET_99");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await get(app, `${base}/${actorId}`); expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal server error.", code: "INTERNAL_SERVER_ERROR" }); expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it("even a service ApiError is sanitized rather than passed through", async () => {
    const { app, service } = setup(); vi.spyOn(service, "listAdminOpen").mockRejectedValue(new ApiError(500, "DATABASE_SECRET_99", "RAW_DATABASE_CODE"));
    const response = await get(app); expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toMatch(/DATABASE_SECRET|RAW_DATABASE/);
  });
  it("lifecycle write failures return sanitized 500", async () => {
    const { app, store, service } = setup(); const row = await service.recordDetection(detection()); store.beforeUpdate = async () => { throw new Error("DATABASE_SECRET_99"); };
    const response = await post(app, row.id, "resolve", { reason: "OPERATOR_RESOLVED" }); expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toContain("DATABASE_SECRET_99");
  });
  it("corrupt evidence is readable but still blocks strict lifecycle operations", async () => {
    const { app, store, service } = setup(); const row = await service.recordDetection(detection()); store.rows.get(row.id)!.evidence = { phone: "FORBIDDEN_SENTINEL_42" };
    expect((await get(app, `${base}/${row.id}`)).status).toBe(200);
    const result = await post(app, row.id, "acknowledge"); expect(result.status).toBe(500); expect(JSON.stringify(result.body)).not.toContain("FORBIDDEN_SENTINEL_42"); expect(store.updates).toBe(0);
  });
  it("core metadata corruption is a sanitized failure, not evidence redaction", async () => {
    const { app, store, service } = setup(); const row = await service.recordDetection(detection()); store.rows.get(row.id)!.revision = -1;
    expect((await get(app, `${base}/${row.id}`)).status).toBe(500); expect((await get(app)).status).toBe(500);
  });
});
