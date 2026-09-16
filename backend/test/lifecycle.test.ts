import { RiskTestStore } from "./risk-test-store.js";
import { OperationalRiskService } from "../src/risk/risk.service.js";
import { createRiskHooks } from "../src/risk/risk.hooks.js";
import { failDelivery } from "../src/delivery-lifecycle/lifecycle.service.js";
import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { UserRole } from "../src/auth/authenticator.js";
import type { LifecycleStore } from "../src/delivery-lifecycle/lifecycle.service.js";
const assignmentId = "10000000-0000-4000-8000-000000000001";
const orderId = "20000000-0000-4000-8000-000000000001";
const riderId = "30000000-0000-4000-8000-000000000001";
const userId = "40000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-31T12:00:00Z");
function authentication(users: Record<string, { userId: string; role: UserRole }>): RequestHandler { return (req, _res, next) => { const token = req.header("authorization")?.replace(/^Bearer /, ""); if (token && users[token]) req.user = { id: users[token].userId, role: users[token].role }; next(); }; }
const authenticate = authentication({ rider: { userId, role: "DELIVERY_PARTNER" }, other: { userId: "40000000-0000-4000-8000-000000000002", role: "DELIVERY_PARTNER" }, customer: { userId, role: "CUSTOMER" } });
interface Options { assignmentStatus?: string; orderStatus?: string; owner?: boolean; inactive?: boolean; assignmentWriteCount?: number; orderWriteCount?: number; riderWriteCount?: number; batchId?: string; remainingBatchAssignments?: number; nextStopAssignmentId?: string; }
function createStore(options: Options = {}) {
  const rider = { id: riderId, userId, isActive: !options.inactive, availability: "BUSY", user: { isActive: !options.inactive } };
  const order = { id: orderId, status: options.orderStatus ?? "RIDER_ASSIGNED", fulfillmentMethod: "DELIVERY", completedAt: null as Date | null };
  const assignment: any = { id: assignmentId, orderId, riderId, batchId: options.batchId ?? null, status: options.assignmentStatus ?? "ACCEPTED", pickedUpAt: null, deliveredAt: null, order };
  const events: any[] = [], stopWrites: any[] = [], batchWrites: any[] = [];
  const store: LifecycleStore = {
    deliveryPartner: {
      findUnique: async (args: any) => args.where.userId === userId ? rider : null,
      updateMany: async (args: any) => { const count = options.riderWriteCount ?? 1; if (count) Object.assign(rider, args.data); return { count }; },
    },
    deliveryAssignment: {
      findFirst: async (args: any) => args.where.id === assignmentId && args.where.riderId === riderId && options.owner !== false ? assignment : null,
      updateMany: async (args: any) => { const count = options.assignmentWriteCount ?? 1; if (count) Object.assign(assignment, args.data); return { count }; },
      count: async () => options.remainingBatchAssignments ?? 0,
    },
    order: { updateMany: async (args: any) => { const count = options.orderWriteCount ?? 1; if (count) Object.assign(order, args.data); return { count }; } },
    deliveryEvent: {
      findFirst: async (args: any) => events.find((event) => event.assignmentId === args.where.assignmentId && event.eventType === args.where.eventType) ? { id: "event" } : null,
      create: async (args: any) => { const event = { ...args.data, id: `90000000-0000-4000-8000-${String(events.length + 1).padStart(12, "0")}` }; events.push(event); return event; },
    },
    deliveryStop: {
      findFirst: async () => {
        const stopType = assignment.status === "ACCEPTED" ? "PHARMACY_PICKUP" : "CUSTOMER_DROPOFF";
        return assignment.batchId ? { id: "stop", assignmentId: options.nextStopAssignmentId ?? assignmentId, stopType, status: stopType === "PHARMACY_PICKUP" ? "PENDING" : assignment.status === "OUT_FOR_DELIVERY" ? "EN_ROUTE" : "PENDING" } : null;
      },
      updateMany: async (args: any) => { stopWrites.push(args); return { count: 1 }; },
    },
    deliveryBatch: { updateMany: async (args: any) => { batchWrites.push(args); return { count: 1 }; } },
    $transaction: async (callback) => {
      const snapshot = { assignment: { ...assignment }, order: { ...order }, rider: { ...rider }, eventLength: events.length };
      try { return await callback(store); } catch (error) { Object.assign(assignment, snapshot.assignment); Object.assign(order, snapshot.order); Object.assign(rider, snapshot.rider); events.length = snapshot.eventLength; throw error; }
    },
  };
  return { store, rider, order, assignment, events, stopWrites, batchWrites };
}
function app(store: LifecycleStore, auth = authenticate) { return createApp({ store: store as any, authenticate: auth, now: () => now, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 }, assignmentConfig: { offerTimeoutMs: 30_000 }, dispatchConfig: { maxCandidates: 10, maxRadiusKm: 15, workloadPenaltyKm: 2 } }); }
const post = (store: LifecycleStore, action: string, body: object = {}) => request(app(store)).post(`/api/v1/delivery-lifecycle/${assignmentId}/${action}`).set("Authorization", "Bearer rider").send(body);
describe("pickup and delivery lifecycle", () => {
  it("records arrival once without changing statuses", async () => {
    const state = createStore(); expect((await post(state.store, "arrive-pharmacy")).status).toBe(200); expect((await post(state.store, "arrive-pharmacy")).status).toBe(200);
    expect(state.events.filter((event) => event.eventType === "ARRIVED_AT_PHARMACY")).toHaveLength(1); expect(state.assignment.status).toBe("ACCEPTED");
  });
  it("completes the full pickup to delivery state machine", async () => {
    const state = createStore();
    expect((await post(state.store, "pickup")).status).toBe(200); expect(state.assignment.status).toBe("PICKED_UP"); expect(state.order.status).toBe("PICKED_UP"); expect(state.assignment.pickedUpAt).toEqual(now);
    expect((await post(state.store, "start-delivery")).status).toBe(200); expect(state.assignment.status).toBe("OUT_FOR_DELIVERY"); expect(state.order.status).toBe("OUT_FOR_DELIVERY");
    const delivered = await post(state.store, "deliver"); expect(delivered.status).toBe(200); expect(state.assignment.status).toBe("DELIVERED"); expect(state.order.status).toBe("DELIVERED"); expect(state.order.completedAt).toEqual(now); expect(state.rider.availability).toBe("AVAILABLE");
    expect(state.events.map((event) => event.eventType)).toEqual(["PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED"]);
  });
  it("is idempotent when the target state already exists", async () => {
    const state = createStore({ assignmentStatus: "PICKED_UP", orderStatus: "PICKED_UP" }); const response = await post(state.store, "pickup");
    expect(response.status).toBe(200); expect(state.events).toEqual([]);
  });
  it("advances batch stops and keeps the rider busy until the final batched delivery", async () => { const batchId = "50000000-0000-4000-8000-000000000001"; const state = createStore({ batchId, assignmentStatus: "OUT_FOR_DELIVERY", orderStatus: "OUT_FOR_DELIVERY", remainingBatchAssignments: 1 }); const response = await post(state.store, "deliver"); expect(response.status).toBe(200); expect(state.stopWrites[0]).toMatchObject({ where: { batchId, assignmentId, stopType: "CUSTOMER_DROPOFF" }, data: { status: "COMPLETED" } }); expect(state.rider.availability).toBe("BUSY"); expect(state.batchWrites).toEqual([]); });
  it("completes the batch and releases the rider after its final delivery", async () => { const batchId = "50000000-0000-4000-8000-000000000001"; const state = createStore({ batchId, assignmentStatus: "OUT_FOR_DELIVERY", orderStatus: "OUT_FOR_DELIVERY", remainingBatchAssignments: 0 }); const response = await post(state.store, "deliver"); expect(response.status).toBe(200); expect(state.batchWrites[0]).toMatchObject({ where: { id: batchId, status: "ACTIVE" }, data: { status: "COMPLETED", completedAt: now } }); expect(state.rider.availability).toBe("AVAILABLE"); });
  it("enforces the optimized stop order before lifecycle writes", async () => { const state = createStore({ batchId: "50000000-0000-4000-8000-000000000001", assignmentStatus: "OUT_FOR_DELIVERY", orderStatus: "OUT_FOR_DELIVERY", nextStopAssignmentId: "10000000-0000-4000-8000-000000000099" }); const response = await post(state.store, "deliver"); expect(response.status).toBe(409); expect(response.body.code).toBe("BATCH_STOP_OUT_OF_ORDER"); expect(state.assignment.status).toBe("OUT_FOR_DELIVERY"); expect(state.events).toEqual([]); });
  it("rejects skipped and backwards transitions", async () => {
    const state = createStore(); const response = await post(state.store, "deliver"); expect(response.status).toBe(409); expect(response.body.code).toBe("LIFECYCLE_NOT_ACTIONABLE"); expect(state.events).toEqual([]);
  });
  it("hides another rider's assignment", async () => {
    const state = createStore({ owner: false }); const response = await post(state.store, "pickup"); expect(response.status).toBe(404); expect(response.body.code).toBe("ASSIGNMENT_NOT_FOUND");
  });
  it("rejects inactive riders", async () => {
    const response = await post(createStore({ inactive: true }).store, "pickup"); expect(response.status).toBe(409); expect(response.body.code).toBe("RIDER_INACTIVE");
  });
  it("requires rider authentication and role", async () => {
    const unauth = await request(app(createStore().store)).post(`/api/v1/delivery-lifecycle/${assignmentId}/pickup`).send({});
    const forbidden = await request(app(createStore().store)).post(`/api/v1/delivery-lifecycle/${assignmentId}/pickup`).set("Authorization", "Bearer customer").send({});
    expect(unauth.status).toBe(401); expect(forbidden.status).toBe(403);
  });
  it("validates IDs and empty action bodies", async () => {
    const invalidId = await request(app(createStore().store)).post("/api/v1/delivery-lifecycle/bad/pickup").set("Authorization", "Bearer rider").send({});
    const invalidBody = await post(createStore().store, "pickup", { status: "DELIVERED" }); expect(invalidId.status).toBe(400); expect(invalidBody.status).toBe(400);
  });
  it("fails delivery with an audit reason and manual-review marker", async () => {
    const state = createStore({ assignmentStatus: "OUT_FOR_DELIVERY", orderStatus: "OUT_FOR_DELIVERY" });
    const response = await post(state.store, "fail", { reason: "Customer unavailable" }); expect(response.status).toBe(200); expect(response.body.data.manualReview).toBe(true); expect(state.assignment.status).toBe("FAILED"); expect(state.order.status).toBe("OUT_FOR_DELIVERY"); expect(state.rider.availability).toBe("AVAILABLE");
    expect(state.events[0]).toMatchObject({ eventType: "FAILED_DELIVERY", note: "Customer unavailable", metadata: { requiresManualReview: true } });
  });
  it("strictly validates failure reasons", async () => {
    const state = createStore({ assignmentStatus: "OUT_FOR_DELIVERY", orderStatus: "OUT_FOR_DELIVERY" }); expect((await post(state.store, "fail", { reason: "" })).status).toBe(400); expect((await post(state.store, "fail", { reason: "x", extra: true })).status).toBe(400);
  });
  it("rolls back all writes after a conditional conflict", async () => {
    const state = createStore({ orderWriteCount: 0 }); const response = await post(state.store, "pickup"); expect(response.status).toBe(409); expect(response.body.code).toBe("LIFECYCLE_CONFLICT"); expect(state.assignment.status).toBe("ACCEPTED"); expect(state.order.status).toBe("RIDER_ASSIGNED"); expect(state.events).toEqual([]);
  });
  it("uses the default authentication boundary", async () => {
    const response = await request(createApp({ store: createStore().store as any, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 }, assignmentConfig: { offerTimeoutMs: 30_000 }, dispatchConfig: { maxCandidates: 10, maxRadiusKm: 15, workloadPenaltyKm: 2 } })).post(`/api/v1/delivery-lifecycle/${assignmentId}/pickup`).send({});
    expect(response.status).toBe(401); expect(response.body.code).toBe("AUTH_REQUIRED");
  });
});


describe("delivery failure post-commit risk integration", () => {
  it("persists the committed event without leaking failure note or changing the response", async () => {
    const state = createStore({ assignmentStatus: "OUT_FOR_DELIVERY", orderStatus: "OUT_FOR_DELIVERY" }); const riskStore = new RiskTestStore(); const service = new OperationalRiskService(riskStore.repository());
    let committed = false; const transaction = state.store.$transaction.bind(state.store);
    state.store.$transaction = async (work, options) => { const value = await transaction(work, options); committed = true; return value; };
    const original = service.recordDetection.bind(service);
    const record = vi.spyOn(service, "recordDetection").mockImplementation(input => { expect(committed).toBe(true); expect(state.events).toHaveLength(1); return original(input); });
    const application = createApp({ store: state.store as any, authenticate, riskService: service, now: () => now });
    const response = await request(application).post(`/api/v1/delivery-lifecycle/${assignmentId}/fail`).set("Authorization", "Bearer rider").send({ reason: "private failure note" });
    const baseline = await post(createStore({ assignmentStatus: "OUT_FOR_DELIVERY", orderStatus: "OUT_FOR_DELIVERY" }).store, "fail", { reason: "private failure note" });
    expect(response.status).toBe(200); expect(response.body).toEqual(baseline.body);
    expect(record).toHaveBeenCalledTimes(1); expect(riskStore.rows.size).toBe(1);
    expect([...riskStore.rows.values()][0].occurrenceKey).toBe(state.events[0].id);
    expect(state.order.status).toBe("OUT_FOR_DELIVERY"); expect(JSON.stringify(record.mock.calls)).not.toContain("private failure note");
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/riderId|coordinates|latitude|longitude/);
    const repeated = await request(application).post(`/api/v1/delivery-lifecycle/${assignmentId}/fail`).set("Authorization", "Bearer rider").send({ reason: "repeat" });
    expect(repeated.status).toBe(200); expect(riskStore.rows.size).toBe(1); expect(state.events).toHaveLength(1); expect(record).toHaveBeenCalledTimes(1);
  });
  it("event-write rollback emits no risk", async () => {
    const state = createStore(); state.store.deliveryEvent.create = async () => { throw new Error("event rollback"); }; const callback = vi.fn();
    await expect(failDelivery(state.store, userId, assignmentId, "private note", { now: () => now, riskHooks: { ...createRiskHooks(), deliveryFailed: callback } })).rejects.toThrow("event rollback");
    expect(callback).not.toHaveBeenCalled(); expect(state.assignment.status).toBe("ACCEPTED");
  });
  it("failed transaction commit emits no risk", async () => {
    const state = createStore(); const callback = vi.fn();
    state.store.$transaction = async work => { await work(state.store); throw new Error("commit failed"); };
    await expect(failDelivery(state.store, userId, assignmentId, "private note", { now: () => now, riskHooks: { ...createRiskHooks(), deliveryFailed: callback } })).rejects.toThrow("commit failed"); expect(callback).not.toHaveBeenCalled();
  });
  it("risk persistence errors never fail the committed delivery mutation", async () => {
    const state = createStore(); const riskStore = new RiskTestStore(); riskStore.createError = new Error("risk failure");
    const result = await failDelivery(state.store, userId, assignmentId, "private note", { now: () => now, riskHooks: createRiskHooks({ riskService: new OperationalRiskService(riskStore.repository()) }) });
    expect(result.status).toBe("FAILED"); expect(result.manualReview).toBe(true); expect(state.events).toHaveLength(1); expect(riskStore.creates).toBe(1);
  });
  it("even a throwing injected hook cannot escape the integration boundary", async () => {
    const state = createStore();
    const result = await failDelivery(state.store, userId, assignmentId, "note", { now: () => now, riskHooks: { ...createRiskHooks(), deliveryFailed: async () => { throw new Error("bad injection"); } } });
    expect(result.status).toBe("FAILED");
  });
});
