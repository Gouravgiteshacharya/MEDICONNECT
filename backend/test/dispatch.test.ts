import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
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
function auth(users: Record<string, { userId: string; role: UserRole }>): RequestHandler { return (req, _res, next) => { const token = req.header("authorization")?.replace(/^Bearer /, ""); if (token && users[token]) req.auth = users[token]; next(); }; }
const authenticate = auth({ admin: { userId: "00000000-0000-0000-0000-000000000001", role: "ADMIN" }, rider: { userId: riderA, role: "DELIVERY_PARTNER" } });

interface Options { existing?: boolean; eligible?: boolean; stale?: boolean; priorRiderIds?: string[]; serializationFailures?: number; }
function createStore(options: Options = {}) {
  const attempts: any[] = []; const assignments: any[] = []; let transactionAttempts = 0;
  const riders = options.eligible === false ? [] : [
    { id: riderA, currentLatitude: 28.62, currentLongitude: 77.21, lastLocationAt: options.stale ? new Date(now.getTime() - 61_000) : new Date(now.getTime() - 5_000), _count: { assignments: 2 } },
    { id: riderB, currentLatitude: 28.64, currentLongitude: 77.22, lastLocationAt: new Date(now.getTime() - 5_000), _count: { assignments: 0 } },
  ];
  const store: DispatchStore = {
    order: { findUnique: async (args: any) => args.where.id === orderId ? { id: orderId, fulfillmentMethod: "DELIVERY", status: "READY_FOR_PICKUP", pharmacy: { latitude: 28.6139, longitude: 77.209 } } : null },
    deliveryPartner: { findMany: async () => riders },
    deliveryAssignment: {
      findFirst: async () => options.existing ? { id: assignmentId, orderId, riderId: riderA, status: "OFFERED", assignedAt: now } : null,
      create: async (args: any) => { const value = { id: assignmentId, ...args.data }; assignments.push(value); return value; },
    },
    dispatchAttempt: {
      findMany: async () => (options.priorRiderIds ?? []).map((riderId) => ({ riderId })),
      createMany: async (args: any) => { attempts.push(...args.data); return { count: args.data.length }; },
      findFirst: async () => null,
      updateMany: async (args: any) => { const item = attempts.find((candidate) => candidate.riderId === args.where.riderId); if (item) Object.assign(item, args.data); return { count: item ? 1 : 0 }; },
    },
    $transaction: async (callback) => { transactionAttempts += 1; if (transactionAttempts <= (options.serializationFailures ?? 0)) throw Object.assign(new Error("conflict"), { code: "P2034" }); return callback(store); },
  };
  return { store, attempts, assignments, get transactionAttempts() { return transactionAttempts; } };
}
function app(store: DispatchStore, authMiddleware = authenticate, mlModel: LogisticsModel | null = null) {
  return createApp({ store: store as any, authenticate: authMiddleware, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 }, assignmentConfig: { offerTimeoutMs: 30_000 }, dispatchConfig: { maxCandidates: 10, maxRadiusKm: 15, workloadPenaltyKm: 2 }, mlModel, now: () => now });
}
describe("deterministic dispatch", () => {
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
    expect(response.status).toBe(503); expect(response.body.code).toBe("AUTH_NOT_CONFIGURED");
  });
});
