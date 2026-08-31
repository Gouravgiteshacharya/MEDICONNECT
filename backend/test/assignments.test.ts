import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { UserRole } from "../src/auth/authenticator.js";
import type { AssignmentStore } from "../src/delivery-assignments/assignment.service.js";

const orderId = "10000000-0000-0000-0000-000000000001";
const riderId = "20000000-0000-0000-0000-000000000001";
const riderUserId = "30000000-0000-0000-0000-000000000001";
const assignmentId = "40000000-0000-0000-0000-000000000001";
const now = new Date("2026-08-30T12:00:00.000Z");
const assignedAt = new Date(now.getTime() - 10_000);

function authentication(users: Record<string, { userId: string; role: UserRole }>): RequestHandler {
  return (req, _res, next) => { const token = req.header("authorization")?.replace(/^Bearer /, ""); if (token && users[token]) req.auth = users[token]; next(); };
}
const authenticate = authentication({
  admin: { userId: "00000000-0000-0000-0000-000000000001", role: "ADMIN" },
  rider: { userId: riderUserId, role: "DELIVERY_PARTNER" },
  other: { userId: "30000000-0000-0000-0000-000000000002", role: "DELIVERY_PARTNER" },
  customer: { userId: "00000000-0000-0000-0000-000000000002", role: "CUSTOMER" },
});

interface Options {
  orderStatus?: string; fulfillmentMethod?: string; riderActive?: boolean; userActive?: boolean;
  availability?: string; lastLocationAt?: Date | null; assignmentStatus?: string; assignmentRiderId?: string;
  riderCoordinates?: boolean;
  existingLive?: boolean; competing?: boolean; assignmentWriteCount?: number; orderWriteCount?: number; riderWriteCount?: number;
  serializationFailures?: number;
  batchId?: string;
}
function createStore(options: Options = {}) {
  const order = { id: orderId, orderNumber: "MED-1", fulfillmentMethod: options.fulfillmentMethod ?? "DELIVERY", status: options.orderStatus ?? "READY_FOR_PICKUP", pharmacyId: "50000000-0000-0000-0000-000000000001" };
  const rider = { id: riderId, userId: riderUserId, availability: options.availability ?? "AVAILABLE", isActive: options.riderActive ?? true,
    currentLatitude: options.riderCoordinates === false ? null : 28.6139, currentLongitude: options.riderCoordinates === false ? null : 77.209,
    lastLocationAt: options.lastLocationAt === undefined ? new Date(now.getTime() - 5_000) : options.lastLocationAt, user: { isActive: options.userActive ?? true } };
  const assignment: any = { id: assignmentId, orderId, riderId: options.assignmentRiderId ?? riderId, batchId: options.batchId ?? null, status: options.assignmentStatus ?? "OFFERED", assignedAt, acceptedAt: null, declinedAt: null, timedOutAt: null, order };
  const state = { assignment, order, rider, batchStatus: options.batchId ? "PLANNED" : null as string | null, events: [] as any[], creates: [] as any[], assignmentWrites: [] as any[], orderWrites: [] as any[], riderWrites: [] as any[], transactionAttempts: 0 };
  const store: AssignmentStore = {
    deliveryPartner: {
      findUnique: async (args: any) => args.where.id === riderId || args.where.userId === riderUserId ? rider : null,
      updateMany: async (args: any) => { state.riderWrites.push(args); if ((options.riderWriteCount ?? 1) === 1) Object.assign(rider, args.data); return { count: options.riderWriteCount ?? 1 }; },
    },
    order: {
      findUnique: async (args: any) => args.where.id === orderId ? order : null,
      updateMany: async (args: any) => { state.orderWrites.push(args); if ((options.orderWriteCount ?? 1) === 1) Object.assign(order, args.data); return { count: options.orderWriteCount ?? 1 }; },
    },
    deliveryAssignment: {
      findFirst: async (args: any) => {
        if (args.where?.orderId === orderId && args.where?.id?.not) return options.competing ? { id: "60000000-0000-0000-0000-000000000001" } as any : null;
        if (args.where?.orderId === orderId && !args.where?.id) return options.existingLive ? assignment : null;
        if (args.where?.id === assignmentId && args.where?.riderId === riderId && assignment.riderId === riderId) return assignment;
        return null;
      },
      findMany: async (args: any) => args.where.riderId === riderId && assignment.riderId === riderId && assignment.status === "OFFERED" ? [assignment] : [],
      create: async (args: any) => { state.creates.push(args); Object.assign(assignment, args.data); return assignment; },
      updateMany: async (args: any) => { state.assignmentWrites.push(args); const count = options.assignmentWriteCount ?? 1; if (count === 1) Object.assign(assignment, args.data); return { count }; },
    },
    deliveryEvent: { createMany: async (args: any) => { state.events.push(...args.data); return { count: args.data.length }; } },
    deliveryBatch: { updateMany: async (args: any) => { if (state.batchStatus === args.where.status) { state.batchStatus = args.data.status; return { count: 1 }; } return { count: 0 }; } },
    $transaction: async (callback) => {
      state.transactionAttempts += 1;
      if (state.transactionAttempts <= (options.serializationFailures ?? 0)) throw Object.assign(new Error("serialization conflict"), { code: "P2034" });
      const snapshot = {
        assignment: { ...assignment }, order: { ...order }, rider: { ...rider },
        eventsLength: state.events.length, assignmentWritesLength: state.assignmentWrites.length,
        orderWritesLength: state.orderWrites.length, riderWritesLength: state.riderWrites.length,
      };
      try { return await callback(store); }
      catch (error) {
        Object.assign(assignment, snapshot.assignment); Object.assign(order, snapshot.order); Object.assign(rider, snapshot.rider);
        state.events.length = snapshot.eventsLength; state.assignmentWrites.length = snapshot.assignmentWritesLength;
        state.orderWrites.length = snapshot.orderWritesLength; state.riderWrites.length = snapshot.riderWritesLength;
        throw error;
      }
    },
  };
  return { store, state };
}
function app(store: AssignmentStore, clock = now, auth: RequestHandler = authenticate) {
  return createApp({ store: store as any, authenticate: auth, assignmentConfig: { offerTimeoutMs: 30_000 }, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 }, now: () => clock });
}

describe("delivery assignment offers", () => {
  it("lets an admin create an eligible offer without changing the order", async () => {
    const { store, state } = createStore();
    const response = await request(app(store)).post("/api/v1/delivery-assignments/offers").set("Authorization", "Bearer admin").send({ orderId, riderId });
    expect(response.status).toBe(201); expect(state.creates).toHaveLength(1); expect(state.creates[0].data.status).toBe("OFFERED"); expect(state.order.status).toBe("READY_FOR_PICKUP");
  });
  it.each(["customer", "rider"])("forbids %s from creating offers", async (token) => {
    const response = await request(app(createStore().store)).post("/api/v1/delivery-assignments/offers").set("Authorization", `Bearer ${token}`).send({ orderId, riderId });
    expect(response.status).toBe(403);
  });
  it("rejects malformed and unknown offer fields", async () => {
    const response = await request(app(createStore().store)).post("/api/v1/delivery-assignments/offers").set("Authorization", "Bearer admin").send({ orderId: "bad", riderId, score: 1 });
    expect(response.status).toBe(400); expect(response.body.code).toBe("INVALID_ASSIGNMENT_REQUEST");
  });
  it.each([{ orderStatus: "PREPARING" }, { fulfillmentMethod: "SELF_PICKUP" }])("rejects ineligible orders", async (options) => {
    const response = await request(app(createStore(options).store)).post("/api/v1/delivery-assignments/offers").set("Authorization", "Bearer admin").send({ orderId, riderId });
    expect(response.status).toBe(409); expect(response.body.code).toBe("ORDER_NOT_ELIGIBLE");
  });
  it.each([
    [{ riderActive: false }, "RIDER_INACTIVE"], [{ userActive: false }, "RIDER_INACTIVE"],
    [{ availability: "OFFLINE" }, "RIDER_UNAVAILABLE"], [{ lastLocationAt: null }, "RIDER_LOCATION_UNAVAILABLE"],
    [{ riderCoordinates: false }, "RIDER_LOCATION_UNAVAILABLE"],
    [{ lastLocationAt: new Date(now.getTime() - 60_001) }, "RIDER_LOCATION_STALE"],
  ] as const)("rejects an ineligible rider", async (options, code) => {
    const response = await request(app(createStore(options).store)).post("/api/v1/delivery-assignments/offers").set("Authorization", "Bearer admin").send({ orderId, riderId });
    expect(response.status).toBe(409); expect(response.body.code).toBe(code);
  });
  it("rejects an existing live assignment", async () => {
    const response = await request(app(createStore({ existingLive: true }).store)).post("/api/v1/delivery-assignments/offers").set("Authorization", "Bearer admin").send({ orderId, riderId });
    expect(response.status).toBe(409); expect(response.body.code).toBe("LIVE_ASSIGNMENT_EXISTS");
  });
  it("lists only the authenticated rider's actionable offers", async () => {
    const response = await request(app(createStore().store)).get("/api/v1/delivery-assignments/offers/me").set("Authorization", "Bearer rider");
    expect(response.status).toBe(200); expect(response.body.data).toHaveLength(1); expect(response.body.data[0].id).toBe(assignmentId);
  });
  it("accepts atomically and synchronizes assignment, order, rider and events", async () => {
    const { store, state } = createStore();
    const response = await request(app(store)).post(`/api/v1/delivery-assignments/${assignmentId}/accept`).set("Authorization", "Bearer rider").send({});
    expect(response.status).toBe(200); expect(state.assignment.status).toBe("ACCEPTED"); expect(state.order.status).toBe("RIDER_ASSIGNED"); expect(state.rider.availability).toBe("BUSY");
    expect(response.body.data.order.status).toBe("RIDER_ASSIGNED");
    expect(state.events.map((event) => event.eventType)).toEqual(["RIDER_ASSIGNED", "RIDER_ACCEPTED"]);
    expect(state.assignmentWrites[0].where).toMatchObject({ id: assignmentId, riderId, status: "OFFERED" });
    expect(state.orderWrites[0].where).toMatchObject({ id: orderId, status: "READY_FOR_PICKUP", fulfillmentMethod: "DELIVERY" });
  });
  it("declines without changing order or rider", async () => {
    const { store, state } = createStore();
    const response = await request(app(store)).post(`/api/v1/delivery-assignments/${assignmentId}/decline`).set("Authorization", "Bearer rider").send({});
    expect(response.status).toBe(200); expect(state.assignment.status).toBe("DECLINED"); expect(state.order.status).toBe("READY_FOR_PICKUP"); expect(state.rider.availability).toBe("AVAILABLE");
  });
  it("allows a busy rider to accept a batched offer and activates the batch", async () => {
    const batchId = "70000000-0000-0000-0000-000000000001"; const { store, state } = createStore({ availability: "BUSY", batchId });
    const response = await request(app(store)).post(`/api/v1/delivery-assignments/${assignmentId}/accept`).set("Authorization", "Bearer rider").send({});
    expect(response.status).toBe(200); expect(state.assignment.status).toBe("ACCEPTED"); expect(state.rider.availability).toBe("BUSY"); expect(state.batchStatus).toBe("ACTIVE"); expect(state.riderWrites).toHaveLength(0);
  });
  it("cancels and detaches a planned batch when its second offer is declined", async () => {
    const batchId = "70000000-0000-0000-0000-000000000001"; const { store, state } = createStore({ availability: "BUSY", batchId });
    const response = await request(app(store)).post(`/api/v1/delivery-assignments/${assignmentId}/decline`).set("Authorization", "Bearer rider").send({});
    expect(response.status).toBe(200); expect(state.batchStatus).toBe("CANCELLED"); expect(state.assignment.batchId).toBeNull();
  });
  it("hides another rider's offer", async () => {
    const response = await request(app(createStore({ assignmentRiderId: "20000000-0000-0000-0000-000000000002" }).store)).post(`/api/v1/delivery-assignments/${assignmentId}/accept`).set("Authorization", "Bearer rider").send({});
    expect(response.status).toBe(404); expect(response.body.code).toBe("OFFER_NOT_FOUND");
  });
  it.each(["accept", "decline"])("expires at the exact boundary during %s", async (action) => {
    const { store, state } = createStore(); const boundary = new Date(assignedAt.getTime() + 30_000);
    const response = await request(app(store, boundary)).post(`/api/v1/delivery-assignments/${assignmentId}/${action}`).set("Authorization", "Bearer rider").send({});
    expect(response.status).toBe(409); expect(response.body.code).toBe("OFFER_EXPIRED"); expect(state.assignment.status).toBe("TIMED_OUT");
  });
  it("lazily expires offers while listing", async () => {
    const { store, state } = createStore(); const boundary = new Date(assignedAt.getTime() + 30_000);
    const response = await request(app(store, boundary)).get("/api/v1/delivery-assignments/offers/me").set("Authorization", "Bearer rider");
    expect(response.status).toBe(200); expect(response.body.data).toEqual([]); expect(state.assignment.status).toBe("TIMED_OUT");
  });
  it("returns a stable conflict when another assignment won", async () => {
    const { store, state } = createStore({ competing: true });
    const response = await request(app(store)).post(`/api/v1/delivery-assignments/${assignmentId}/accept`).set("Authorization", "Bearer rider").send({});
    expect(response.status).toBe(409); expect(response.body.code).toBe("ASSIGNMENT_ACCEPTANCE_CONFLICT"); expect(state.events).toEqual([]);
  });
  it("returns a stable conflict when a conditional write loses", async () => {
    const { store, state } = createStore({ assignmentWriteCount: 0 });
    const response = await request(app(store)).post(`/api/v1/delivery-assignments/${assignmentId}/accept`).set("Authorization", "Bearer rider").send({});
    expect(response.status).toBe(409); expect(response.body.code).toBe("ASSIGNMENT_ACCEPTANCE_CONFLICT"); expect(state.events).toEqual([]);
    expect(state.assignment.status).toBe("OFFERED"); expect(state.order.status).toBe("READY_FOR_PICKUP"); expect(state.rider.availability).toBe("AVAILABLE");
  });
  it("retries bounded serialization conflicts", async () => {
    const { store, state } = createStore({ serializationFailures: 2 });
    const response = await request(app(store)).post(`/api/v1/delivery-assignments/${assignmentId}/accept`).set("Authorization", "Bearer rider").send({});
    expect(response.status).toBe(200); expect(state.transactionAttempts).toBe(3);
  });
  it("maps exhausted serialization conflicts to a stable conflict", async () => {
    const { store, state } = createStore({ serializationFailures: 3 });
    const response = await request(app(store)).post(`/api/v1/delivery-assignments/${assignmentId}/accept`).set("Authorization", "Bearer rider").send({});
    expect(response.status).toBe(409); expect(response.body.code).toBe("ASSIGNMENT_ACCEPTANCE_CONFLICT"); expect(state.transactionAttempts).toBe(3);
  });
  it("uses the unconfigured authentication boundary by default", async () => {
    const response = await request(createApp({ store: createStore().store as any, assignmentConfig: { offerTimeoutMs: 30_000 }, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 } })).get("/api/v1/delivery-assignments/offers/me");
    expect(response.status).toBe(503); expect(response.body.code).toBe("AUTH_NOT_CONFIGURED");
  });
});
