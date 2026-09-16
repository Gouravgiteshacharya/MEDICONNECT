import { describe, expect, it, vi } from "vitest";
import { createRiskHooks, type RiskHookDependencies, type SafeRiskHookError } from "../src/risk/risk.hooks.js";
import { OperationalRiskService } from "../src/risk/risk.service.js";
import { RiskTestStore, entityId, orderId, actorId, secondActorId, time } from "./risk-test-store.js";

const at = (ms: number) => new Date(time.getTime() + ms);
const timeout = () => ({ assignmentId: entityId, orderId, status: "TIMED_OUT", assignedAt: at(-40_000), offerExpiresAt: at(-10_000), timedOutAt: time, evaluatedAt: time });
const failure = (eventId = actorId) => ({ assignmentId: entityId, orderId, assignmentStatus: "FAILED", evaluatedAt: time, failureEvent: { id: eventId, eventType: "FAILED_DELIVERY", occurredAt: time, orderStatusAtFailure: "OUT_FOR_DELIVERY", requiresManualReview: true } });
const stale = (lastLocationAt = at(-60_001), evaluatedAt = time) => ({ assignmentId: entityId, orderId, assignmentStatus: "ACCEPTED", lastLocationAt, freshnessThresholdMs: 60_000, evaluatedAt });
const recovery = (lastLocationAt: Date | null = at(1), evaluatedAt = at(1)) => ({ riderId: actorId, lastLocationAt, evaluatedAt, freshnessThresholdMs: 60_000 });
function setup(overrides: RiskHookDependencies = {}) {
  const store = new RiskTestStore(); const service = new OperationalRiskService(store.repository());
  const errors: SafeRiskHookError[] = [];
  const reader = vi.fn(async () => [{ assignmentId: entityId, assignmentStatus: "ACCEPTED", orderId }]);
  const hooks = createRiskHooks({ riskService: service, readActiveRiskAssignments: reader, onRiskHookError: event => { errors.push(event); }, ...overrides });
  return { store, service, errors, reader, hooks };
}

describe("post-commit risk hooks", () => {
  it("defaults to disabled without reads, writes, or error notifications", async () => {
    const reader = vi.fn(); const observer = vi.fn(); const hooks = createRiskHooks({ readActiveRiskAssignments: reader, onRiskHookError: observer });
    await hooks.assignmentTimedOut(timeout()); await hooks.deliveryFailed(failure()); await hooks.observeLocation(stale()); await hooks.locationUpdated(recovery());
    expect(reader).not.toHaveBeenCalled(); expect(observer).not.toHaveBeenCalled();
  });
  it("records timeout once under repeated callbacks without automatic lifecycle changes", async () => {
    const { hooks, store } = setup(); await hooks.assignmentTimedOut(timeout()); await hooks.assignmentTimedOut(timeout());
    expect(store.rows.size).toBe(1); expect([...store.rows.values()][0]).toMatchObject({ status: "OPEN", ruleCode: "ASSIGNMENT_OFFER_TIMED_OUT", revision: 0 });
  });
  it("does not persist a timeout nonmatch or unavailable facts", async () => {
    const { hooks, store, errors } = setup();
    await hooks.assignmentTimedOut({ ...timeout(), status: "ACCEPTED" });
    await hooks.assignmentTimedOut({ ...timeout(), timedOutAt: null });
    expect(store.rows.size).toBe(0); expect(errors).toEqual([{ operation: "record_detection", ruleCode: "ASSIGNMENT_OFFER_TIMED_OUT", reason: "evaluation_unavailable" }]);
  });
  it("failure callbacks converge per durable event; separate events remain separate", async () => {
    const { hooks, store } = setup(); await hooks.deliveryFailed(failure()); await hooks.deliveryFailed(failure()); await hooks.deliveryFailed(failure(secondActorId));
    expect(store.rows.size).toBe(2);
    expect([...store.rows.values()].every(row => row.status === "OPEN" && row.resolutionPolicy === "MANUAL_RESOLUTION")).toBe(true);
  });
  it("manual-review false and unavailable failure events never persist", async () => {
    const { hooks, store } = setup(); const input = failure();
    await hooks.deliveryFailed({ ...input, failureEvent: { ...input.failureEvent, requiresManualReview: false } });
    await hooks.deliveryFailed({ ...input, failureEvent: null }); expect(store.rows.size).toBe(0);
  });
  it.each(["assignmentTimedOut", "deliveryFailed", "observeLocation"] as const)("%s isolates persistence errors and emits only safe fields", async method => {
    const { hooks, store, errors } = setup(); store.createError = new Error("db secret rider email address coordinates");
    const work = method === "assignmentTimedOut" ? () => hooks.assignmentTimedOut(timeout()) : method === "deliveryFailed" ? () => hooks.deliveryFailed(failure()) : () => hooks.observeLocation(stale());
    await expect(work()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1); expect(Object.keys(errors[0]).sort()).toEqual(["operation", "reason", "ruleCode"]);
    expect(errors[0].reason).toBe("persistence_failed"); expect(JSON.stringify(errors)).not.toMatch(/secret|coordinates|address|email/);
  });
  it("unexpected evaluator exception and rejected observer are isolated", async () => {
    const observer = vi.fn(async () => { throw new Error("observer failure"); }); const { hooks, store } = setup({ onRiskHookError: observer });
    const input = Object.defineProperty(timeout(), "status", { get() { throw new Error("programmer failure private data"); } });
    await expect(hooks.assignmentTimedOut(input)).resolves.toBeUndefined(); expect(store.rows.size).toBe(0); expect(observer).toHaveBeenCalledWith({ operation: "record_detection", ruleCode: "ASSIGNMENT_OFFER_TIMED_OUT", reason: "persistence_failed" });
  });
  it("same stale episode converges and retains original evidence", async () => {
    const { hooks, store } = setup(); await hooks.observeLocation(stale()); const original = structuredClone([...store.rows.values()][0]);
    await hooks.observeLocation(stale(at(-60_001), at(1000))); expect([...store.rows.values()]).toEqual([original]);
  });
  it("fresh reads do not create or resolve assessments", async () => {
    const { hooks, store } = setup(); await hooks.observeLocation(stale());
    await hooks.observeLocation(stale(time)); expect(store.rows.size).toBe(1); expect([...store.rows.values()][0].status).toBe("OPEN");
  });
  it("unavailable read facts do not persist or resolve", async () => {
    const { hooks, store } = setup(); await hooks.observeLocation({ ...stale(), lastLocationAt: null }); expect(store.rows.size).toBe(0);
  });
  it("fresh update resolves the old episode using null actor and CONDITION_CLEARED", async () => {
    const { hooks, store, reader } = setup(); await hooks.observeLocation(stale()); await hooks.locationUpdated(recovery());
    expect(reader).toHaveBeenCalledWith(actorId);
    expect([...store.rows.values()][0]).toMatchObject({ status: "RESOLVED", resolvedByAdminId: null, resolutionReason: "CONDITION_CLEARED", resolvedAt: at(1), revision: 1 });
    await hooks.locationUpdated(recovery(at(2), at(2))); expect([...store.rows.values()][0].revision).toBe(1);
  });
  it("acknowledged stale episodes may recover without erasing acknowledgement", async () => {
    const { hooks, store, service } = setup(); await hooks.observeLocation(stale()); const row = [...store.rows.values()][0];
    await service.acknowledgeAssessment({ id: row.id, expectedRevision: 0, at: time, actorId });
    await hooks.locationUpdated(recovery()); expect([...store.rows.values()][0]).toMatchObject({ status: "RESOLVED", acknowledgedByAdminId: actorId, revision: 2 });
  });
  it("new stale anchor after recovery creates a new open occurrence", async () => {
    const { hooks, store } = setup(); await hooks.observeLocation(stale()); await hooks.locationUpdated(recovery());
    await hooks.observeLocation(stale(at(1), at(60_002)));
    expect([...store.rows.values()].map(row => row.status)).toEqual(["RESOLVED", "OPEN"]);
  });
  it("old recovery cannot resolve a newer stale episode or later observation", async () => {
    const { hooks, store } = setup();
    await hooks.observeLocation(stale(at(10), at(60_011)));
    await hooks.observeLocation(stale(at(-60_001), at(70_000)));
    await hooks.locationUpdated(recovery(at(1), at(1)));
    expect([...store.rows.values()].every(row => row.status === "OPEN")).toBe(true);
  });
  it("recovery never resolves an equal location anchor", async () => {
    const { hooks, store } = setup(); await hooks.observeLocation(stale());
    await hooks.locationUpdated(recovery(at(-60_001), at(-60_001))); expect([...store.rows.values()][0].status).toBe("OPEN");
  });
  it.each([null, new Date(NaN), at(10)])("missing/invalid/future location %s cannot resolve", async lastLocationAt => {
    const { hooks, store } = setup(); await hooks.observeLocation(stale()); await hooks.locationUpdated(recovery(lastLocationAt));
    expect([...store.rows.values()][0].status).toBe("OPEN");
  });
  it("a stale update snapshot is not recovery", async () => {
    const { hooks, store } = setup(); await hooks.observeLocation(stale()); await hooks.locationUpdated(recovery(at(1), at(70_000)));
    expect([...store.rows.values()][0].status).toBe("OPEN");
  });
  it("zero-threshold fresh update recovers correctly", async () => {
    const { hooks, store } = setup(); await hooks.observeLocation({ ...stale(), freshnessThresholdMs: 0 }); await hooks.locationUpdated({ ...recovery(), freshnessThresholdMs: 0 });
    expect([...store.rows.values()][0].status).toBe("RESOLVED");
  });
  it.each([{ rows: [] }, { rows: [{ assignmentId: entityId, orderId, assignmentStatus: "DELIVERED" }] }])("unknown/inactive assignment does not resolve: %j", async ({ rows }) => {
    const { hooks, store } = setup({ readActiveRiskAssignments: async () => rows }); await hooks.observeLocation(stale()); await hooks.locationUpdated(recovery()); expect([...store.rows.values()][0].status).toBe("OPEN");
  });
  it("read failures are isolated and never resolve", async () => {
    const { hooks, store, errors } = setup({ readActiveRiskAssignments: async () => { throw new Error("database secret"); } });
    await hooks.observeLocation(stale()); await hooks.locationUpdated(recovery()); expect([...store.rows.values()][0].status).toBe("OPEN"); expect(errors[0]).toEqual({ operation: "auto_resolve", ruleCode: "RIDER_LOCATION_STALE", reason: "persistence_failed" });
  });
  it("missing recovery reader reports service_unavailable", async () => {
    const { hooks, errors } = setup({ readActiveRiskAssignments: undefined }); await hooks.locationUpdated(recovery()); expect(errors[0]?.reason).toBe("service_unavailable");
  });
  it("does not cross assignment scope or resolve dismissed/manual records", async () => {
    const { hooks, service, store } = setup(); await hooks.observeLocation(stale());
    await hooks.observeLocation({ ...stale(), assignmentId: secondActorId }); await hooks.deliveryFailed(failure());
    const own = [...store.rows.values()][0]; await service.dismissAssessment({ id: own.id, expectedRevision: 0, actorId, at: time, reason: "FALSE_POSITIVE" });
    await hooks.locationUpdated(recovery()); expect([...store.rows.values()].map(row => row.status)).toEqual(["DISMISSED", "OPEN", "OPEN"]);
  });
  it("a concurrent dismissal wins without retry or overwritten actor", async () => {
    const { hooks, service, store } = setup(); await hooks.observeLocation(stale()); const row = [...store.rows.values()][0];
    store.beforeUpdate = async () => { await service.dismissAssessment({ id: row.id, expectedRevision: 0, actorId, at: time, reason: "FALSE_POSITIVE" }); };
    await hooks.locationUpdated(recovery()); expect([...store.rows.values()][0]).toMatchObject({ status: "DISMISSED", dismissedByAdminId: actorId, resolvedAt: null });
  });
  it("paginates order history before resolution so page shifts cannot skip its own writes", async () => {
    const { hooks, store } = setup();
    for (let i = 0; i < 105; i++) await hooks.observeLocation(stale(at(-60_001 - i)));
    await hooks.locationUpdated(recovery()); expect([...store.rows.values()].filter(row => row.status === "RESOLVED")).toHaveLength(105);
  });
  it("resolution persistence failure is isolated", async () => {
    const { store, service, errors, reader } = setup();
    const hooks = createRiskHooks({ riskService: { recordDetection: input => service.recordDetection(input), listByOrder: (id, page) => service.listByOrder(id, page), resolveAssessment: async () => { throw new Error("private database failure"); } }, readActiveRiskAssignments: reader, onRiskHookError: e => { errors.push(e); } });
    await hooks.observeLocation(stale()); await expect(hooks.locationUpdated(recovery())).resolves.toBeUndefined();
    expect([...store.rows.values()][0].status).toBe("OPEN"); expect(errors[0].operation).toBe("auto_resolve");
  });
});
