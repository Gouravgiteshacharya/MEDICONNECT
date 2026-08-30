import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { UserRole } from "../src/auth/authenticator.js";
import type { LocationStore } from "../src/location/location.service.js";

const userId = "00000000-0000-0000-0000-000000000001";
const riderId = "10000000-0000-0000-0000-000000000001";
const assignmentId = "20000000-0000-0000-0000-000000000001";
const batchId = "30000000-0000-0000-0000-000000000001";
const now = new Date("2026-08-30T12:00:00.000Z");

function authentication(users: Record<string, { userId: string; role: UserRole }>): RequestHandler {
  return (req, _res, next) => {
    const token = req.header("authorization")?.replace(/^Bearer /, "");
    if (token && users[token]) req.auth = users[token];
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
    const unrelatedBatchId = "40000000-0000-0000-0000-000000000001";
    const { store, state } = createStore({ assignmentBatchId: unrelatedBatchId });
    const response = await request(app(store)).patch("/api/v1/riders/me/location").set("Authorization", "Bearer rider")
      .send({ ...validBody, assignmentId, batchId });
    expect(response.status).toBe(409); expect(response.body.code).toBe("ASSIGNMENT_BATCH_MISMATCH");
    expect(state.assignmentQueries[0].where).toEqual({ id: assignmentId, riderId });
    expect(state.batchQueries[0].where).toEqual({ id: batchId, riderId });
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
    expect(response.status).toBe(400); expect(response.body).toEqual({ error: "Malformed JSON request body", code: "INVALID_JSON" });
  });

  it("rejects unauthenticated access", async () => {
    const response = await request(app(createStore().store)).patch("/api/v1/riders/me/location").send(validBody);
    expect(response.status).toBe(401); expect(response.body.code).toBe("UNAUTHENTICATED");
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
  it("uses the unconfigured production authentication boundary by default", async () => {
    const response = await request(createApp({ store: createStore().store, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 } }))
      .patch("/api/v1/riders/me/location").send(validBody);
    expect(response.status).toBe(503); expect(response.body.code).toBe("AUTH_NOT_CONFIGURED");
  });
});
