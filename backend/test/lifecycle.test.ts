import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { UserRole } from "../src/auth/authenticator.js";
import type { LifecycleStore } from "../src/delivery-lifecycle/lifecycle.service.js";
const assignmentId = "10000000-0000-0000-0000-000000000001";
const orderId = "20000000-0000-0000-0000-000000000001";
const riderId = "30000000-0000-0000-0000-000000000001";
const userId = "40000000-0000-0000-0000-000000000001";
const now = new Date("2026-08-31T12:00:00Z");
function authentication(users: Record<string, { userId: string; role: UserRole }>): RequestHandler { return (req, _res, next) => { const token = req.header("authorization")?.replace(/^Bearer /, ""); if (token && users[token]) req.auth = users[token]; next(); }; }
const authenticate = authentication({ rider: { userId, role: "DELIVERY_PARTNER" }, other: { userId: "40000000-0000-0000-0000-000000000002", role: "DELIVERY_PARTNER" }, customer: { userId, role: "CUSTOMER" } });
interface Options { assignmentStatus?: string; orderStatus?: string; owner?: boolean; inactive?: boolean; assignmentWriteCount?: number; orderWriteCount?: number; riderWriteCount?: number; batchId?: string; remainingBatchAssignments?: number; }
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
      create: async (args: any) => { events.push(args.data); return args.data; },
    },
    deliveryStop: { updateMany: async (args: any) => { stopWrites.push(args); return { count: 1 }; } },
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
  it("advances batch stops and keeps the rider busy until the final batched delivery", async () => { const batchId = "50000000-0000-0000-0000-000000000001"; const state = createStore({ batchId, assignmentStatus: "OUT_FOR_DELIVERY", orderStatus: "OUT_FOR_DELIVERY", remainingBatchAssignments: 1 }); const response = await post(state.store, "deliver"); expect(response.status).toBe(200); expect(state.stopWrites[0]).toMatchObject({ where: { batchId, assignmentId, stopType: "CUSTOMER_DROPOFF" }, data: { status: "COMPLETED" } }); expect(state.rider.availability).toBe("BUSY"); expect(state.batchWrites).toEqual([]); });
  it("completes the batch and releases the rider after its final delivery", async () => { const batchId = "50000000-0000-0000-0000-000000000001"; const state = createStore({ batchId, assignmentStatus: "OUT_FOR_DELIVERY", orderStatus: "OUT_FOR_DELIVERY", remainingBatchAssignments: 0 }); const response = await post(state.store, "deliver"); expect(response.status).toBe(200); expect(state.batchWrites[0]).toMatchObject({ where: { id: batchId, status: "ACTIVE" }, data: { status: "COMPLETED", completedAt: now } }); expect(state.rider.availability).toBe("AVAILABLE"); });
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
    expect(response.status).toBe(503); expect(response.body.code).toBe("AUTH_NOT_CONFIGURED");
  });
});
