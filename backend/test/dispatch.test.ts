import { readFileSync } from "node:fs";
import { createDispatchRuntime, disabledDispatchRuntime, type DispatchShadowDependencies, type DispatchShadowRuntime } from "../src/ml/dispatch-runtime.js";
import { DispatchAcceptanceModel } from "../src/ml/dispatch-model.js";
import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { UserRole } from "../src/auth/authenticator.js";
import { rankDispatchCandidates } from "../src/dispatch/dispatch.ranking.js";
import type { DispatchStore } from "../src/dispatch/dispatch.service.js";
import type { LogisticsModel } from "../src/ml/logistics-model.js";

const orderId = "10000000-0000-0000-0000-000000000001";
const assignmentId = "20000000-0000-0000-0000-000000000001";
const now = new Date("2026-08-31T10:00:00Z");
const riderA = "30000000-0000-0000-0000-000000000001";
const riderB = "30000000-0000-0000-0000-000000000002";
function auth(users: Record<string, { userId: string; role: UserRole }>): RequestHandler { return (req, _res, next) => { const token = req.header("authorization")?.replace(/^Bearer /, ""); if (token && users[token]) req.user = { id: users[token].userId, role: users[token].role }; next(); }; }
const authenticate = auth({ admin: { userId: "00000000-0000-0000-0000-000000000001", role: "ADMIN" }, rider: { userId: riderA, role: "DELIVERY_PARTNER" } });

interface Options { existing?: boolean; eligible?: boolean; stale?: boolean; priorRiderIds?: string[]; serializationFailures?: number; failAfterWrites?: boolean; }
function createStore(options: Options = {}) {
  const attempts: any[] = []; const assignments: any[] = []; let transactionAttempts = 0; let committedTransactions = 0;
  const riders = options.eligible === false ? [] : [
    { id: riderA, currentLatitude: 28.62, currentLongitude: 77.21, lastLocationAt: options.stale ? new Date(now.getTime() - 61_000) : new Date(now.getTime() - 5_000), _count: { assignments: 2 } },
    { id: riderB, currentLatitude: 28.64, currentLongitude: 77.22, lastLocationAt: new Date(now.getTime() - 5_000), _count: { assignments: 0 } },
  ];
  const store: DispatchStore = {
    order: { findUnique: async (args: any) => args.where.id === orderId ? { id: orderId, fulfillmentMethod: "DELIVERY", status: "READY_FOR_PICKUP", pharmacy: { latitude: 28.6139, longitude: 77.209 } } : null },
    deliveryPartner: { findMany: async () => riders },
    deliveryAssignment: {
      findFirst: async () => options.existing ? { id: assignmentId, orderId, riderId: riderA, status: "OFFERED", assignedAt: now } : null,
      create: async (args: any) => { const value = { id: assignmentId, ...args.data }; assignments.push(value); return Object.fromEntries(Object.entries(value).filter(([key]) => args.select[key])); },
    },
    dispatchAttempt: {
      findMany: async () => (options.priorRiderIds ?? []).map((riderId) => ({ riderId })),
      createMany: async (args: any) => { attempts.push(...args.data); return { count: args.data.length }; },
      findFirst: async () => null,
      updateMany: async (args: any) => { const item = attempts.find((candidate) => candidate.riderId === args.where.riderId && candidate.dispatchRoundId === args.where.dispatchRoundId); if (item) Object.assign(item, args.data); return { count: item ? 1 : 0 }; },
    },
    $transaction: async (callback) => {
      transactionAttempts += 1;
      const priorAttempts = structuredClone(attempts), priorAssignments = structuredClone(assignments);
      try {
        const result = await callback(store);
        if (transactionAttempts <= (options.serializationFailures ?? 0)) throw Object.assign(new Error("conflict"), { code: "P2034" });
        if (options.failAfterWrites) throw new Error("write failed");
        committedTransactions += 1;
        return result;
      } catch (error) { attempts.splice(0, attempts.length, ...priorAttempts); assignments.splice(0, assignments.length, ...priorAssignments); throw error; }
    },
  };
  return { store, attempts, assignments, get transactionAttempts() { return transactionAttempts; }, get committedTransactions() { return committedTransactions; } };
}
function app(store: DispatchStore, authMiddleware = authenticate, mlModel: LogisticsModel | null = null) {
  return createApp({ store: store as any, authenticate: authMiddleware, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 }, assignmentConfig: { offerTimeoutMs: 30_000 }, dispatchConfig: { maxCandidates: 10, maxRadiusKm: 15, workloadPenaltyKm: 2 }, mlModel, now: () => now });
}
describe("deterministic dispatch", () => {
  it("persists exact deterministic round provenance without exposing fields", async () => {
    const state = createStore(); const response = await request(app(state.store)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(response.status).toBe(201);
    expect(state.attempts).toHaveLength(2);
    const [first, second] = state.attempts;
    expect(first.dispatchRoundId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.dispatchRoundId).toBe(first.dispatchRoundId);
    expect(first).toMatchObject({ riderId: riderB, deterministicRank: 1, dispatchPolicyVersion: "deterministic-dispatch-v1", selectionPolicy: "DETERMINISTIC_FALLBACK", legacyModelVersion: null, workloadPenaltyKm: 2, shortlistSize: 10, searchRadiusKm: 15, freshnessThresholdMs: 60000, status: "OFFERED", assignmentId });
    expect(second).toMatchObject({ riderId: riderA, deterministicRank: 2, status: "CANDIDATE" });
    expect(second.assignmentId).toBeUndefined();
    for (const candidate of state.attempts) expect(candidate.routeCompatibilityScore).toBe(candidate.riderDistanceToPharmacyKm + candidate.workloadSignal * 2);
    expect(state.assignments[0].offerExpiresAt).toEqual(new Date(now.getTime() + 30000));
    expect(response.body.data.assignment).not.toHaveProperty("offerExpiresAt");
    expect(response.body.data).not.toHaveProperty("dispatchRoundId");
    const next = createStore(); await request(app(next.store)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(next.attempts[0].dispatchRoundId).not.toBe(first.dispatchRoundId);
  });
  it("keeps deterministic ranks when legacy ML changes selection", async () => {
    const state = createStore(); const model: LogisticsModel = { predictDispatch: f => ({ predictedCompletionMinutes: f.workload ? 1 : 50, modelVersion: "legacy-v1" }), predictEta: () => { throw new Error("unused"); } };
    await request(app(state.store, authenticate, model)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(state.attempts.find(c => c.riderId === riderA)).toMatchObject({ deterministicRank: 2, status: "OFFERED", legacyModelVersion: "legacy-v1", selectionPolicy: "ML_ASSISTED" });
    expect(state.attempts.find(c => c.riderId === riderB)).toMatchObject({ deterministicRank: 1, status: "CANDIDATE" });
  });
  it.each([{ failAfterWrites: true }, { serializationFailures: 3 }])("rolls back all instrumentation on failure %j", async options => {
    const state = createStore(options); const response = await request(app(state.store)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(response.status).toBeGreaterThanOrEqual(400); expect(state.attempts).toEqual([]); expect(state.assignments).toEqual([]);
  });
  it("commits only one round after retries that fail after writes", async () => {
    const state = createStore({ serializationFailures: 2 });
    const response = await request(app(state.store)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(response.status).toBe(201); expect(state.transactionAttempts).toBe(3); expect(state.attempts).toHaveLength(2); expect(new Set(state.attempts.map(c => c.dispatchRoundId)).size).toBe(1); expect(state.assignments).toHaveLength(1);
  });
  it("preserves shortlist cap and radius while snapshotting configured timeout", async () => {
    const state = createStore();
    const instance = createApp({ store: state.store as any, authenticate, now: () => now, assignmentConfig: { offerTimeoutMs: 45000 }, dispatchConfig: { maxCandidates: 1, maxRadiusKm: 15, workloadPenaltyKm: 2 } });
    const response = await request(instance).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(response.status).toBe(201); expect(state.attempts).toHaveLength(1); expect(state.attempts[0]).toMatchObject({ riderId: riderB, shortlistSize: 1, deterministicRank: 1 }); expect(state.assignments[0].offerExpiresAt).toEqual(new Date(now.getTime() + 45000));
    const far = createStore(); const rejected = await request(createApp({ store: far.store as any, authenticate, now: () => now, dispatchConfig: { maxCandidates: 1, maxRadiusKm: 0.001, workloadPenaltyKm: 2 } })).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(rejected.body.code).toBe("NO_ELIGIBLE_RIDER"); expect(far.attempts).toEqual([]);
  });
  it("ranks deterministically using distance and workload", () => {
    const ranked = rankDispatchCandidates([{ riderId: riderA, distanceKm: 1, workload: 2 }, { riderId: riderB, distanceKm: 2, workload: 0 }], 2);
    expect(ranked.map((item) => item.riderId)).toEqual([riderB, riderA]); expect(ranked[0].score).toBe(2);
  });
  it("creates audited candidates and offers the top-ranked rider", async () => {
    const state = createStore(); const response = await request(app(state.store)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(response.status).toBe(201); expect(response.body.data.alreadyDispatched).toBe(false); expect(state.attempts).toHaveLength(2); expect(state.assignments).toHaveLength(1);
    expect(state.attempts.filter((item) => item.status === "OFFERED")).toHaveLength(1); expect(state.assignments[0].riderId).toBe(state.attempts.find((item) => item.status === "OFFERED").riderId);
  });
  it("uses valid ML completion predictions to assist eligible-rider ranking", async () => { const state = createStore(); const model: LogisticsModel = { predictDispatch: (features) => ({ predictedCompletionMinutes: features.workload === 2 ? 1 : 50, modelVersion: "test-v1" }), predictEta: () => ({ predictedCompletionMinutes: 1, modelVersion: "test-v1" }) }; const response = await request(app(state.store, authenticate, model)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({}); expect(response.status).toBe(201); expect(response.body.data.optimization).toMatchObject({ mode: "ML_ASSISTED", modelVersion: "test-v1", predictedCompletionMinutes: 1 }); expect(state.assignments[0].riderId).toBe(riderA); expect(state.attempts.find((item) => item.riderId === riderA)).toMatchObject({ suitabilityScore: 1 }); });
  it("falls back deterministically when ML inference fails", async () => { const state = createStore(); const model: LogisticsModel = { predictDispatch: () => { throw new Error("model unavailable"); }, predictEta: () => { throw new Error("model unavailable"); } }; const response = await request(app(state.store, authenticate, model)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({}); expect(response.status).toBe(201); expect(response.body.data.optimization).toMatchObject({ mode: "DETERMINISTIC_FALLBACK", modelVersion: null, predictedCompletionMinutes: null }); expect(state.assignments[0].riderId).toBe(riderB); });
  it("is idempotent when a live assignment exists", async () => {
    const state = createStore({ existing: true }); const response = await request(app(state.store)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(response.status).toBe(201); expect(response.body.data.alreadyDispatched).toBe(true); expect(state.attempts).toEqual([]); expect(state.assignments).toEqual([]);
  });
  it("excludes riders attempted by prior dispatch rounds", async () => {
    const state = createStore({ priorRiderIds: [riderB] }); const response = await request(app(state.store)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(response.status).toBe(201); expect(state.assignments[0].riderId).toBe(riderA); expect(state.attempts.every((item) => item.riderId !== riderB)).toBe(true);
  });
  it.each([{ eligible: false }, { stale: true, priorRiderIds: [riderB] }])("returns a manual-escalation outcome when no rider is eligible", async (options) => {
    const response = await request(app(createStore(options).store)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(response.status).toBe(409); expect(response.body.code).toBe("NO_ELIGIBLE_RIDER");
  });
  it("requires admin and validates input", async () => {
    const forbidden = await request(app(createStore().store)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer rider").send({});
    const invalid = await request(app(createStore().store)).post("/api/v1/dispatch/orders/not-a-uuid").set("Authorization", "Bearer admin").send({});
    expect(forbidden.status).toBe(403); expect(invalid.status).toBe(400);
  });
  it("retries serialization conflicts", async () => {
    const state = createStore({ serializationFailures: 2 }); const response = await request(app(state.store)).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
    expect(response.status).toBe(201); expect(state.transactionAttempts).toBe(3);
  });
  it("uses the default authentication boundary", async () => {
    const response = await request(createApp({ store: createStore().store as any, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 }, assignmentConfig: { offerTimeoutMs: 30_000 }, dispatchConfig: { maxCandidates: 10, maxRadiusKm: 15, workloadPenaltyKm: 2 } })).post(`/api/v1/dispatch/orders/${orderId}`).send({});
    expect(response.status).toBe(401); expect(response.body.code).toBe("AUTH_REQUIRED");
  });
});

function shadowApp(store: DispatchStore, shadow: DispatchShadowDependencies = {}, mlModel: LogisticsModel | null = null, maxCandidates = 10) {
  return createApp({ store: store as any, authenticate, now: () => now, ...shadow,
    locationConfig: { sampleIntervalMs: 15000, freshnessThresholdMs: 60000 }, assignmentConfig: { offerTimeoutMs: 30000 },
    dispatchConfig: { maxCandidates, maxRadiusKm: 15, workloadPenaltyKm: 2 }, mlModel,
    mlConfig: { enabled: true, maxPredictionMinutes: 240, fallbackSpeedKmh: 20, timezoneOffsetMinutes: 330 } });
}
const dispatchRequest = (instance: ReturnType<typeof shadowApp>) => request(instance).post(`/api/v1/dispatch/orders/${orderId}`).set("Authorization", "Bearer admin").send({});
const normalizedAttempts = (attempts: any[]) => attempts.map(({ dispatchRoundId: _round, ...row }) => row);
const reverseShadow = (): DispatchShadowRuntime => ({ status: "ready", scoreCandidates(inputs) {
  return { status: "predicted", modelVersion: "SHADOW-TEST-ONLY", dataProvenance: "SYNTHETIC", candidates: inputs.map((c, i) => ({
    candidateKey: c.candidateKey, deterministicRank: i + 1, acceptanceProbability: (i + 1) / (inputs.length + 1), shadowRank: inputs.length - i,
  })) };
} });
const legacyShadowTestModel: LogisticsModel = { predictDispatch: f => ({ predictedCompletionMinutes: f.workload ? 1 : 50, modelVersion: "legacy-authoritative-test" }), predictEta() { throw new Error("unused"); } };

describe("acceptance shadow cannot alter authoritative dispatch", () => {
  it.each(["disabled", "unavailable", "ready"] as const)("preserves complete response and writes in %s state", async status => {
    for (const legacy of [null, legacyShadowTestModel]) {
      const baseline = createStore(), state = createStore();
      const original = await dispatchRequest(shadowApp(baseline.store, {}, legacy));
      const runtime: DispatchShadowRuntime = status === "disabled" ? disabledDispatchRuntime : status === "ready" ? reverseShadow()
        : { status: "unavailable", scoreCandidates: () => ({ status: "unavailable", reason: "file_not_found" }) };
      const observer = vi.fn();
      const response = await dispatchRequest(shadowApp(state.store, { dispatchShadowRuntime: runtime, onDispatchShadowResult: observer }, legacy));
      expect(response.status).toBe(201);
      expect(response.body).toEqual(original.body);
      expect(state.assignments).toEqual(baseline.assignments);
      expect(normalizedAttempts(state.attempts)).toEqual(normalizedAttempts(baseline.attempts));
      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer.mock.calls[0][0]).toMatchObject({ status: status === "ready" ? "predicted" : status, candidateCount: 2, selectedDeterministicRank: legacy ? 2 : 1,
        selectionPolicy: legacy ? "ML_ASSISTED" : "DETERMINISTIC_FALLBACK" });
      expect(state.attempts[0].legacyModelVersion).toBe(legacy ? "legacy-authoritative-test" : null);
      expect(state.assignments[0].riderId).toBe(legacy ? riderA : riderB);
    }
  });
  it("receives only the exact deterministic shortlist snapshots and persisted attemptedAt", async () => {
    const state = createStore(); const runtime = reverseShadow(); const scorer = vi.spyOn(runtime, "scoreCandidates");
    await dispatchRequest(shadowApp(state.store, { dispatchShadowRuntime: runtime }, legacyShadowTestModel));
    expect(scorer).toHaveBeenCalledTimes(1);
    const inputs = scorer.mock.calls[0][0];
    expect(inputs).toHaveLength(2);
    for (let i = 0; i < inputs.length; i++) {
      const persisted = state.attempts.find(a => a.deterministicRank === i + 1);
      expect(inputs[i]).toEqual({ candidateKey: `candidate-${i + 1}`, riderDistanceKm: persisted.riderDistanceToPharmacyKm,
        activeWorkload: persisted.workloadSignal, attemptedAt: persisted.attemptedAt });
      expect(Object.keys(inputs[i]).sort()).toEqual(["candidateKey", "riderDistanceKm", "activeWorkload", "attemptedAt"].sort());
    }
    const capped = createStore(), cappedRuntime = reverseShadow(), cappedSpy = vi.spyOn(cappedRuntime, "scoreCandidates");
    await dispatchRequest(shadowApp(capped.store, { dispatchShadowRuntime: cappedRuntime }, null, 1));
    expect(cappedSpy.mock.calls[0][0]).toHaveLength(1);
    expect(capped.assignments[0].riderId).toBe(riderB);
    const excluded = createStore({ priorRiderIds: [riderB] }), excludedRuntime = reverseShadow(), excludedSpy = vi.spyOn(excludedRuntime, "scoreCandidates");
    await dispatchRequest(shadowApp(excluded.store, { dispatchShadowRuntime: excludedRuntime }));
    expect(excludedSpy.mock.calls[0][0]).toHaveLength(1);
    expect(excluded.assignments[0].riderId).toBe(riderA);
  });
  it("uses the independent timezone and exact persisted features with a real runtime", async () => {
    const artifact = readFileSync(new URL("./fixtures/dispatch-model-artifact.synthetic.test.json", import.meta.url), "utf8");
    const runtime = await createDispatchRuntime({ NODE_ENV: "test", ML_DISPATCH_SHADOW_ENABLED: "true", ML_DISPATCH_ALLOW_SYNTHETIC: "true",
      ML_DISPATCH_MODEL_PATH: "test.json", ML_DISPATCH_TIMEZONE_OFFSET_MINUTES: "-720" }, { readFile: async () => artifact });
    const spy = vi.spyOn(DispatchAcceptanceModel.prototype, "predict");
    try {
      const state = createStore(); const observer = vi.fn();
      await dispatchRequest(shadowApp(state.store, { dispatchShadowRuntime: runtime, onDispatchShadowResult: observer }));
      expect(spy).toHaveBeenCalledTimes(2);
      const ordered = [...state.attempts].sort((a, b) => a.deterministicRank - b.deterministicRank);
      spy.mock.calls.forEach(([raw], i) => expect(raw).toEqual({ riderDistanceKm: ordered[i].riderDistanceToPharmacyKm,
        activeWorkload: ordered[i].workloadSignal, hourOfDay: 22, dayOfWeek: 0 }));
      expect(observer.mock.calls[0][0].status).toBe("predicted");
    } finally { spy.mockRestore(); }
  });
  it("emits once only after final commit following two serialization rollbacks", async () => {
    const state = createStore({ serializationFailures: 2 }), runtime = reverseShadow();
    const scorer = vi.spyOn(runtime, "scoreCandidates");
    const observedCommits: number[] = [];
    const observer = vi.fn(() => { observedCommits.push(state.committedTransactions); });
    const response = await dispatchRequest(shadowApp(state.store, { dispatchShadowRuntime: runtime, onDispatchShadowResult: observer }));
    expect(response.status).toBe(201); expect(state.transactionAttempts).toBe(3);
    expect(scorer).toHaveBeenCalledTimes(3); expect(observer).toHaveBeenCalledTimes(1); expect(observedCommits).toEqual([1]);
    expect(state.attempts).toHaveLength(2); expect(state.assignments).toHaveLength(1);
  });
  it.each([{ serializationFailures: 3 }, { failAfterWrites: true }])("never observes rolled-back state %j", async options => {
    const state = createStore(options), observer = vi.fn();
    const response = await dispatchRequest(shadowApp(state.store, { dispatchShadowRuntime: reverseShadow(), onDispatchShadowResult: observer }));
    expect(response.status).toBeGreaterThanOrEqual(400); expect(observer).not.toHaveBeenCalled();
    expect(state.committedTransactions).toBe(0); expect(state.assignments).toEqual([]); expect(state.attempts).toEqual([]);
  });
  it.each([{ existing: true }, { eligible: false }])("does not score or observe absent new decision %j", async options => {
    const state = createStore(options), runtime = reverseShadow(), scorer = vi.spyOn(runtime, "scoreCandidates"), observer = vi.fn();
    const response = await dispatchRequest(shadowApp(state.store, { dispatchShadowRuntime: runtime, onDispatchShadowResult: observer }));
    expect(response.status).toBe(options.existing ? 201 : 409);
    expect(scorer).not.toHaveBeenCalled(); expect(observer).not.toHaveBeenCalled();
    expect(state.attempts).toEqual([]); expect(state.assignments).toEqual([]);
  });
  it("isolates runtime exceptions and protects authoritative snapshots from injected mutation", async () => {
    const baseline = createStore(), state = createStore(), observer = vi.fn();
    const original = await dispatchRequest(shadowApp(baseline.store));
    const runtime: DispatchShadowRuntime = { status: "ready", scoreCandidates(inputs) {
      (inputs[0] as any).riderDistanceKm = 999;
      inputs[0].attemptedAt.setTime(0);
      throw new Error("private rider scores");
    } };
    const response = await dispatchRequest(shadowApp(state.store, { dispatchShadowRuntime: runtime, onDispatchShadowResult: observer }));
    expect(response.body).toEqual(original.body);
    expect(state.assignments).toEqual(baseline.assignments);
    expect(normalizedAttempts(state.attempts)).toEqual(normalizedAttempts(baseline.attempts));
    expect(observer.mock.calls[0][0]).toMatchObject({ status: "unavailable", reason: "prediction_failed", scoredCandidateCount: 0 });
    expect(JSON.stringify(observer.mock.calls)).not.toContain("private");
  });
  it.each([false, true])("isolates observer errors without retry, asynchronous=%s", async asynchronous => {
    const state = createStore();
    const error = Object.assign(new Error("private"), { code: "P2034" });
    const observer = vi.fn(() => { if (asynchronous) return Promise.reject(error); throw error; });
    const response = await dispatchRequest(shadowApp(state.store, { dispatchShadowRuntime: reverseShadow(), onDispatchShadowResult: observer }));
    expect(response.status).toBe(201); expect(observer).toHaveBeenCalledTimes(1);
    expect(state.transactionAttempts).toBe(1); expect(state.assignments).toHaveLength(1);
  });
  it("never exposes identities, individual scores or shadow fields in response/observation/writes", async () => {
    const state = createStore(), observer = vi.fn();
    const response = await dispatchRequest(shadowApp(state.store, { dispatchShadowRuntime: reverseShadow(), onDispatchShadowResult: observer }));
    const telemetry = JSON.stringify(observer.mock.calls[0][0]);
    for (const forbidden of [riderA, riderB, orderId, assignmentId, "candidateKey", "acceptanceProbability", "riderDistanceKm", "activeWorkload", "attemptedAt"]) expect(telemetry).not.toContain(forbidden);
    expect(JSON.stringify(response.body)).not.toMatch(/shadowRank|acceptanceProbability|SHADOW-TEST-ONLY/);
    expect(JSON.stringify([state.assignments, state.attempts])).not.toMatch(/shadowRank|acceptanceProbability|SHADOW-TEST-ONLY/);
    expect(state.assignments).toHaveLength(1); expect(state.attempts).toHaveLength(2);
  });
});
