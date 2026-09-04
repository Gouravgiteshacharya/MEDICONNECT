import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { UserRole } from "../src/auth/authenticator.js";
import type { RiderStore } from "../src/riders/rider.service.js";
const userId = "00000000-0000-0000-0000-000000000001";
function authentication(users: Record<string, { userId: string; role: UserRole }>): RequestHandler {
  return (req, _res, next) => {
    const token = req.header("authorization")?.replace(/^Bearer /, "");
    if (token && users[token]) req.user = { id: users[token].userId, role: users[token].role };
    next();
  };
}
function rider(overrides: Record<string, unknown> = {}) {
  return {
    id: "10000000-0000-0000-0000-000000000001", userId, availability: "OFFLINE" as const,
    vehicleType: "BIKE", vehicleNumber: null, rating: null, isActive: true,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    user: { id: userId, name: "Rider", email: "rider@example.com", phone: null, isActive: true }, ...overrides,
  };
}
function store(record = rider()): RiderStore {
  const api: RiderStore = {
    deliveryPartner: {
      findUnique: async () => record,
      update: async (args) => ({ ...record, availability: args.data.availability }),
    },
    $transaction: async (callback) => callback(api),
  };
  return api;
}
const authenticate = authentication({ rider: { userId, role: "DELIVERY_PARTNER" }, customer: { userId, role: "CUSTOMER" } });
describe("rider profile and availability", () => {
  it("reports versioned API health", async () => {
    const response = await request(createApp({ store: store(), authenticate })).get("/api/v1/health");
    expect(response.status).toBe(200); expect(response.body).toEqual({ status: "ok" });
  });
  it("returns the authenticated rider profile", async () => {
    const response = await request(createApp({ store: store(), authenticate })).get("/api/v1/riders/me").set("Authorization", "Bearer rider");
    expect(response.status).toBe(200); expect(response.body.data.userId).toBe(userId);
  });
  it("changes availability to a rider-controlled value", async () => {
    const response = await request(createApp({ store: store(), authenticate })).patch("/api/v1/riders/me/availability").set("Authorization", "Bearer rider").send({ availability: "AVAILABLE" });
    expect(response.status).toBe(200); expect(response.body.data.availability).toBe("AVAILABLE");
  });
  it("prevents a busy rider from overriding lifecycle-managed availability", async () => {
    const response = await request(createApp({ store: store(rider({ availability: "BUSY" })), authenticate })).patch("/api/v1/riders/me/availability").set("Authorization", "Bearer rider").send({ availability: "OFFLINE" });
    expect(response.status).toBe(409); expect(response.body.code).toBe("RIDER_BUSY");
  });
  it("rejects unauthenticated access", async () => {
    const response = await request(createApp({ store: store(), authenticate })).get("/api/v1/riders/me");
    expect(response.status).toBe(401); expect(response.body).toEqual({ error: "Authentication required.", code: "AUTH_REQUIRED" });
  });
  it("rejects users with the wrong role", async () => {
    const response = await request(createApp({ store: store(), authenticate })).get("/api/v1/riders/me").set("Authorization", "Bearer customer");
    expect(response.status).toBe(403); expect(response.body.code).toBe("FORBIDDEN");
  });
  it.each(["BUSY", "UNKNOWN", null])("rejects invalid manual availability %s", async (availability) => {
    const response = await request(createApp({ store: store(), authenticate })).patch("/api/v1/riders/me/availability").set("Authorization", "Bearer rider").send({ availability });
    expect(response.status).toBe(400); expect(response.body.code).toBe("INVALID_AVAILABILITY");
  });
  it.each([rider({ isActive: false }), rider({ user: { id: userId, name: "Rider", email: "rider@example.com", phone: null, isActive: false } })])
    ("prevents an inactive rider or user from becoming available", async (inactiveRider) => {
      const response = await request(createApp({ store: store(inactiveRider), authenticate })).patch("/api/v1/riders/me/availability").set("Authorization", "Bearer rider").send({ availability: "AVAILABLE" });
      expect(response.status).toBe(409); expect(response.body.code).toBe("RIDER_INACTIVE");
    });
});
