import { RiskTestStore } from "./risk-test-store.js";
import { OperationalRiskService } from "../src/risk/risk.service.js";
import { createRiskHooks } from "../src/risk/risk.hooks.js";
import { updateRiderLocation } from "../src/location/location.service.js";
import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { UserRole } from "../src/auth/authenticator.js";
import type { LocationStore } from "../src/location/location.service.js";

const userId = "00000000-0000-4000-8000-000000000001";
const riderId = "10000000-0000-4000-8000-000000000001";
const assignmentId = "20000000-0000-4000-8000-000000000001";
const batchId = "30000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-30T12:00:00.000Z");

function authentication(users: Record<string, { userId: string; role: UserRole }>): RequestHandler {
  return (req, _res, next) => {
    const token = req.header("authorization")?.replace(/^Bearer /, "");
    if (token && users[token]) req.user = { id: users[token].userId, role: users[token].role };
    next();
  };
}
const authenticate = authentication({ rider: { userId, role: "DELIVERY_PARTNER" }, customer: { userId, role: "CUSTOMER" } });

function createStore(options: {
  userActive?: boolean; riderActive?: boolean; latestAt?: Date | null; ownsAssignment?: boolean;
  ownsBatch?: boolean; assignmentBatchId?: string | null;
} = {}) {
  const state = {
    rider: {
      id: riderId, userId, availability: "AVAILABLE" as const, vehicleType: "BIKE", vehicleNumber: null, rating: null,
      currentLatitude: null as number | null, currentLongitude: null as number | null, lastLocationAt: null as Date | null,
      isActive: options.riderActive ?? true, createdAt: now, updatedAt: now,
      user: { id: userId, name: "Rider", email: "rider@example.com", phone: null, isActive: options.userActive ?? true },
    },
    history: [] as any[],
    assignmentQueries: [] as any[],
    batchQueries: [] as any[],
    currentLocationUpdates: 0,
    latestLocationQueries: 0,
  };
  const store: LocationStore = {
    deliveryPartner: {
      findUnique: async () => state.rider,
      update: async (args) => { state.currentLocationUpdates += 1; Object.assign(state.rider, args.data); return state.rider; },
    },
    deliveryAssignment: { findFirst: async (args: any) => {
      state.assignmentQueries.push(args);
      return options.ownsAssignment !== false && args.where.id === assignmentId && args.where.riderId === riderId
        ? { id: assignmentId, batchId: options.assignmentBatchId === undefined ? batchId : options.assignmentBatchId }
        : null;
    } },
    deliveryBatch: { findFirst: async (args: any) => {
      state.batchQueries.push(args);
      return options.ownsBatch !== false && args.where.id === batchId && args.where.riderId === riderId ? { id: batchId } : null;
    } },
    locationUpdate: {
      findFirst: async () => { state.latestLocationQueries += 1; return options.latestAt ? { recordedAt: options.latestAt } : null; },
      create: async (args: any) => { state.history.push(args.data); return args.data; },
    },
    $transaction: async (callback) => callback(store),
  };
  return { store, state };
}

function app(store: LocationStore, auth: RequestHandler = authenticate) {
  return createApp({ store, authenticate: auth, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 }, now: () => now });
}
const validBody = { latitude: 28.6139, longitude: 77.209, accuracyMeters: 8 };

describe("PATCH /api/v1/riders/me/location", () => {
  it("always updates the current rider location using server time", async () => {
    const { store, state } = createStore({ latestAt: new Date(now.getTime() - 5_000) });
    const response = await request(app(store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider").send(validBody);
    expect(response.status).toBe(200);
    expect(response.body.data.historyRecorded).toBe(false);
    expect(state.rider).toMatchObject({ currentLatitude: validBody.latitude, currentLongitude: validBody.longitude, lastLocationAt: now });
  });

  it("creates a sampled history record with owned assignment and batch", async () => {
    const { store, state } = createStore({ latestAt: new Date(now.getTime() - 15_000) });
    const response = await request(app(store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider")
      .send({ ...validBody, assignmentId, batchId, recordedAt: undefined });
    expect(response.status).toBe(200); expect(response.body.data.historyRecorded).toBe(true);
    expect(state.history[0]).toMatchObject({ riderId, assignmentId, batchId, recordedAt: now, ...validBody });
    expect(state.assignmentQueries[0]).toMatchObject({ where: { id: assignmentId, riderId }, select: { id: true, batchId: true } });
    expect(state.batchQueries[0]).toMatchObject({ where: { id: batchId, riderId } });
  });

  it("rejects owned but unrelated assignment and batch before modifying location", async () => {
    const unrelatedBatchId = "40000000-0000-4000-8000-000000000001";
    const { store, state } = createStore({ assignmentBatchId: unrelatedBatchId });
    const response = await request(app(store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider")
      .send({ ...validBody, assignmentId, batchId });
    expect(response.status).toBe(409); expect(response.body.code).toBe("ASSIGNMENT_BATCH_MISMATCH");
    expect(state.assignmentQueries[0].where).toEqual({ id: assignmentId, riderId, status: { in: ["OFFERED", "ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"] } });
    expect(state.batchQueries[0].where).toEqual({ id: batchId, riderId, status: { in: ["PLANNED", "ACTIVE"] } });
    expect(state.currentLocationUpdates).toBe(0);
    expect(state.latestLocationQueries).toBe(0);
    expect(state.history).toHaveLength(0);
    expect(state.rider).toMatchObject({ currentLatitude: null, currentLongitude: null, lastLocationAt: null });
  });

  it("skips history sampling inside the configured interval", async () => {
    const { store, state } = createStore({ latestAt: new Date(now.getTime() - 14_999) });
    const response = await request(app(store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider").send(validBody);
    expect(response.status).toBe(200); expect(response.body.data.historyRecorded).toBe(false); expect(state.history).toHaveLength(0);
  });

  it.each([
    [{ ...validBody, latitude: 91 }, "latitude"],
    [{ ...validBody, longitude: -181 }, "longitude"],
    [{ ...validBody, accuracyMeters: -1 }, "accuracyMeters"],
    [{ ...validBody, latitude: "28.6" }, "latitude"],
  ])("rejects invalid location input", async (body, field) => {
    const response = await request(app(createStore().store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider").send(body);
    expect(response.status).toBe(400); expect(response.body.code).toBe("INVALID_LOCATION_REQUEST"); expect(response.body.error).toContain(field);
  });

  it("rejects unknown request fields and client timestamps", async () => {
    const response = await request(app(createStore().store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider")
      .send({ ...validBody, recordedAt: "2020-01-01T00:00:00Z" });
    expect(response.status).toBe(400); expect(response.body.code).toBe("INVALID_LOCATION_REQUEST");
  });

  it("rejects malformed JSON consistently", async () => {
    const response = await request(app(createStore().store)).patch("/api/v1/riders/me/location")
      .set("Authorization", "Bearer rider").set("Content-Type", "application/json").send('{"latitude":');
    expect(response.status).toBe(400); expect(response.body).toEqual({ error: "Malformed JSON body.", code: "MALFORMED_JSON" });
  });

  it("rejects unauthenticated access", async () => {
    const response = await request(app(createStore().store)).patch("/api/v1/riders/me/location").send(validBody);
    expect(response.status).toBe(401); expect(response.body.code).toBe("AUTH_REQUIRED");
  });
  it("rejects wrong-role access", async () => {
    const response = await request(app(createStore().store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer customer").send(validBody);
    expect(response.status).toBe(403); expect(response.body.code).toBe("FORBIDDEN");
  });
  it.each([{ userActive: false }, { riderActive: false }])("rejects inactive users and riders", async (options) => {
    const response = await request(app(createStore(options).store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider").send(validBody);
    expect(response.status).toBe(409); expect(response.body.code).toBe("RIDER_INACTIVE");
  });
  it("rejects an assignment owned by another rider", async () => {
    const response = await request(app(createStore({ ownsAssignment: false }).store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider").send({ ...validBody, assignmentId });
    expect(response.status).toBe(403); expect(response.body.code).toBe("ASSIGNMENT_NOT_OWNED");
  });
  it("rejects a batch owned by another rider", async () => {
    const response = await request(app(createStore({ ownsBatch: false }).store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider").send({ ...validBody, batchId });
    expect(response.status).toBe(403); expect(response.body.code).toBe("BATCH_NOT_OWNED");
  });
  it("uses the Platform Core authentication boundary by default", async () => {
    const response = await request(createApp({ store: createStore().store, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 } }))
      .patch("/api/v1/riders/me/location").send(validBody);
    expect(response.status).toBe(401); expect(response.body.code).toBe("AUTH_REQUIRED");
  });
});


describe("location update post-commit risk recovery", () => {
  const riskOrderId = "50000000-0000-4000-8000-000000000001";
  async function existingStale() {
    const riskStore = new RiskTestStore(); const service = new OperationalRiskService(riskStore.repository());
    await createRiskHooks({ riskService: service }).observeLocation({ assignmentId, orderId: riskOrderId, assignmentStatus: "ACCEPTED", lastLocationAt: new Date(now.getTime() - 70_000), evaluatedAt: new Date(now.getTime() - 1), freshnessThresholdMs: 60_000 });
    return { riskStore, service };
  }
  it("reads active assignments only after commit and resolves the old episode", async () => {
    const { store, state } = createStore(); const { riskStore, service } = await existingStale(); let committed = false;
    const transaction = store.$transaction.bind(store);
    store.$transaction = async (work, options) => { const result = await transaction(work, options); committed = true; return result; };
    const reader = vi.fn(async (id: string) => { expect(committed).toBe(true); expect(id).toBe(riderId); expect(state.rider.lastLocationAt).toEqual(now); return [{ assignmentId, assignmentStatus: "ACCEPTED", orderId: riskOrderId }]; });
    const application = createApp({ store, authenticate, riskService: service, readActiveRiskAssignments: reader, now: () => now, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 } });
    const response = await request(application).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider").send(validBody);
    const baseline = await request(app(createStore().store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider").send(validBody);
    expect(response.status).toBe(200); expect(response.body).toEqual(baseline.body); expect(reader).toHaveBeenCalledTimes(1);
    expect([...riskStore.rows.values()][0]).toMatchObject({ status: "RESOLVED", resolutionReason: "CONDITION_CLEARED", resolvedByAdminId: null, entityType: "DELIVERY_ASSIGNMENT" });
  });
  it("passes only committed identity/time to the hook, never coordinates or contacts", async () => {
    const { store } = createStore(); const callback = vi.fn(async () => {});
    await updateRiderLocation(store, userId, validBody, { now: () => now, sampleIntervalMs: 15000, freshnessThresholdMs: 60000, riskHooks: { ...createRiskHooks(), locationUpdated: callback } });
    expect(callback).toHaveBeenCalledWith({ riderId, lastLocationAt: now, evaluatedAt: now, freshnessThresholdMs: 60000 });
  });
  it("failed location mutation never performs recovery", async () => {
    const { store } = createStore(); const callback = vi.fn(); store.deliveryPartner.update = async () => { throw new Error("write failed"); };
    await expect(updateRiderLocation(store, userId, validBody, { now: () => now, sampleIntervalMs: 15000, riskHooks: { ...createRiskHooks(), locationUpdated: callback } })).rejects.toThrow("write failed"); expect(callback).not.toHaveBeenCalled();
  });
  it("commit failure never performs recovery", async () => {
    const { store } = createStore(); const callback = vi.fn(); store.$transaction = async work => { await work(store); throw new Error("commit failed"); };
    await expect(updateRiderLocation(store, userId, validBody, { now: () => now, sampleIntervalMs: 15000, riskHooks: { ...createRiskHooks(), locationUpdated: callback } })).rejects.toThrow("commit failed"); expect(callback).not.toHaveBeenCalled();
  });
  it("recovery read failure does not fail the location update", async () => {
    const { store, state } = createStore(); const { service, riskStore } = await existingStale();
    const result = await updateRiderLocation(store, userId, validBody, { now: () => now, sampleIntervalMs: 15000, freshnessThresholdMs: 60000, riskHooks: createRiskHooks({ riskService: service, readActiveRiskAssignments: async () => { throw new Error("risk lookup unavailable"); } }) });
    expect(result.historyRecorded).toBe(true); expect(state.rider.lastLocationAt).toEqual(now); expect([...riskStore.rows.values()][0].status).toBe("OPEN");
  });
  it("no known active assignment cannot clear the assessment", async () => {
    const { store } = createStore(); const { service, riskStore } = await existingStale();
    await updateRiderLocation(store, userId, validBody, { now: () => now, sampleIntervalMs: 15000, freshnessThresholdMs: 60000, riskHooks: createRiskHooks({ riskService: service, readActiveRiskAssignments: async () => [] }) });
    expect([...riskStore.rows.values()][0].status).toBe("OPEN");
  });
});
