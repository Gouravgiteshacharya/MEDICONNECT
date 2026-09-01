import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { UserRole } from "../src/auth/authenticator.js";
import type { DeliveryQuoteStore } from "../src/delivery-quotes/delivery-quote.service.js";
import type { DistanceProvider } from "../src/delivery-quotes/distance-provider.js";
import type { LogisticsModel } from "../src/ml/logistics-model.js";

const customerId = "00000000-0000-0000-0000-000000000001";
const otherCustomerId = "00000000-0000-0000-0000-000000000002";
const addressId = "10000000-0000-0000-0000-000000000001";
const pharmacyId = "20000000-0000-0000-0000-000000000001";
const quoteId = "30000000-0000-0000-0000-000000000001";
const now = new Date("2026-08-30T12:00:00.000Z");

function authentication(users: Record<string, { userId: string; role: UserRole }>): RequestHandler {
  return (req, _res, next) => {
    const token = req.header("authorization")?.replace(/^Bearer /, "");
    if (token && users[token]) req.user = { id: users[token].userId, role: users[token].role };
    next();
  };
}
const authenticate = authentication({ customer: { userId: customerId, role: "CUSTOMER" }, rider: { userId: customerId, role: "DELIVERY_PARTNER" } });

interface StoreOptions {
  customerActive?: boolean; addressOwned?: boolean; addressCoordinates?: boolean;
  pharmacyExists?: boolean; pharmacyActive?: boolean; pharmacyVerified?: boolean;
  partnerStatus?: string; pharmacyCoordinates?: boolean;
  activeOrders?: number; availableRiders?: number;
}
function createStore(options: StoreOptions = {}) {
  const state = {
    userQueries: [] as any[], addressQueries: [] as any[], pharmacyQueries: [] as any[], creates: [] as any[],
    activeTransactions: 0, events: [] as string[], demandOrderQueries: [] as any[], demandRiderQueries: [] as any[],
  };
  const store = {
    deliveryPartner: { findUnique: async () => null, update: async () => { throw new Error("unused"); }, count: async (args: any) => { state.demandRiderQueries.push(args); return options.availableRiders ?? 0 } },
    order: { count: async (args: any) => { state.demandOrderQueries.push(args); return options.activeOrders ?? 0 } },
    user: { findFirst: async (args: any) => {
      state.userQueries.push(args);
      return args.where.id === customerId && args.where.role === "CUSTOMER" ? { id: customerId, isActive: options.customerActive ?? true } : null;
    } },
    address: { findFirst: async (args: any) => {
      state.addressQueries.push(args);
      if (options.addressOwned === false || args.where.id !== addressId || args.where.userId !== customerId) return null;
      return { id: addressId, userId: customerId, latitude: options.addressCoordinates === false ? null : 19.076, longitude: options.addressCoordinates === false ? null : 72.8777 };
    } },
    pharmacy: { findUnique: async (args: any) => {
      state.pharmacyQueries.push(args);
      if (options.pharmacyExists === false || args.where.id !== pharmacyId) return null;
      return {
        id: pharmacyId, latitude: options.pharmacyCoordinates === false ? null : 28.6139,
        longitude: options.pharmacyCoordinates === false ? null : 77.209,
        isActive: options.pharmacyActive ?? true, isVerified: options.pharmacyVerified ?? true,
        partnerStatus: options.partnerStatus ?? "ACTIVE",
      };
    } },
    deliveryQuote: { create: async (args: any) => {
      state.events.push("quote:create");
      state.creates.push(args);
      return { id: quoteId, createdAt: args.data.createdAt, expiresAt: args.data.expiresAt };
    } },
    $transaction: async (callback: any) => {
      state.activeTransactions += 1;
      state.events.push("transaction:start");
      try { return await callback(store); }
      finally { state.activeTransactions -= 1; state.events.push("transaction:end"); }
    },
  } as unknown as DeliveryQuoteStore;
  return { store, state };
}

const config = { baseFeePaise: 4000, feePerKmPaise: 800, expiryMs: 15 * 60_000 };
const provider: DistanceProvider = { calculate: async () => ({ distanceKm: 3.4567 }) };
function app(store: DeliveryQuoteStore, auth: RequestHandler = authenticate, distanceProvider: DistanceProvider = provider) {
  return createApp({ store, authenticate: auth, deliveryQuoteConfig: config, distanceProvider, mlModel: null, now: () => now });
}
const validBody = { pharmacyId, deliveryAddressId: addressId };

describe("POST /api/v1/delivery-quotes", () => {
  it("creates a customer-safe quote with exact persisted components and server timestamps", async () => {
    const { store, state } = createStore();
    const orderedProvider: DistanceProvider = { calculate: async () => {
      expect(state.activeTransactions).toBe(0);
      state.events.push("provider:success");
      return { distanceKm: 3.4567 };
    } };
    const response = await request(app(store, authenticate, orderedProvider)).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send(validBody);
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({
      id: quoteId, pharmacyId, deliveryAddressId: addressId, distanceKm: 3.46,
      baseFee: "40.00", distanceFee: "27.65", demandAdjustment: "0.00",
      demandMultiplier: "1.00", finalDeliveryFee: "67.65",
      estimatedDurationMinutes: 11,
      demand: { activeOrders: 0, availableRiders: 0, orderToRiderRatio: 0, tier: "DISABLED" },
      etaAssistance: { mode: "DETERMINISTIC_FALLBACK", modelVersion: null, deterministicMinutes: 11, predictedMinutes: null },
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + config.expiryMs).toISOString(),
    });
    expect(state.creates[0].data).toEqual({
      customerId, pharmacyId, deliveryAddressId: addressId, deliveryLatitude: 19.076,
      deliveryLongitude: 72.8777, distanceKm: 3.4567, baseFee: "40.00",
      distanceFee: "27.65", demandAdjustment: "0.00", demandMultiplier: "1.00",
      finalDeliveryFee: "67.65", estimatedDurationMinutes: 11,
      createdAt: now, expiresAt: new Date(now.getTime() + config.expiryMs),
    });
    expect(state.userQueries[0].where).toEqual({ id: customerId, role: "CUSTOMER" });
    expect(state.addressQueries[0].where).toEqual({ id: addressId, userId: customerId });
    expect(state.pharmacyQueries[0].where).toEqual({ id: pharmacyId });
    expect(state.events).toEqual(["transaction:start", "transaction:end", "provider:success", "quote:create"]);
  });

  it("applies and transparently returns a capped database demand tier", async () => {
    const dynamicConfig = { ...config, demand: { moderateRatio: 1, highRatio: 2, peakRatio: 3, moderateMultiplierBps: 11000, highMultiplierBps: 12000, peakMultiplierBps: 13000 } };
    const { store, state } = createStore({ activeOrders: 5, availableRiders: 2 });
    const response = await request(createApp({ store, authenticate, deliveryQuoteConfig: dynamicConfig, distanceProvider: provider, mlModel: null, now: () => now, locationConfig: { sampleIntervalMs: 15000, freshnessThresholdMs: 60000 } })).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send(validBody);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ demandAdjustment: "13.53", demandMultiplier: "1.20", finalDeliveryFee: "81.18", demand: { activeOrders: 5, availableRiders: 2, orderToRiderRatio: 2.5, tier: "HIGH" } });
    expect(state.creates[0].data).toMatchObject({ demandAdjustment: "13.53", demandMultiplier: "1.20", finalDeliveryFee: "81.18" });
    expect(state.creates[0].data).not.toHaveProperty("demand");
    expect(state.demandOrderQueries[0].where).toMatchObject({ fulfillmentMethod: "DELIVERY", status: { in: expect.arrayContaining(["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"]) } });
    expect(state.demandRiderQueries[0].where).toMatchObject({ availability: "AVAILABLE", isActive: true, user: { isActive: true }, lastLocationAt: { gte: new Date(now.getTime() - 60000) } });
  });
  it("uses ML ETA assistance when a valid prediction is available", async () => { const { store, state } = createStore(); const model: LogisticsModel = { predictDispatch: () => ({ predictedCompletionMinutes: 1, modelVersion: "test-v1" }), predictEta: () => ({ predictedCompletionMinutes: 37.2, modelVersion: "test-v1" }) }; const response = await request(createApp({ store, authenticate, deliveryQuoteConfig: config, distanceProvider: { calculate: async () => ({ distanceKm: 3.4567, durationMinutes: 20 }) }, mlModel: model, now: () => now })).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send(validBody); expect(response.status).toBe(201); expect(response.body.data).toMatchObject({ estimatedDurationMinutes: 38, etaAssistance: { mode: "ML_ASSISTED", modelVersion: "test-v1", deterministicMinutes: 20, predictedMinutes: 38 } }); expect(state.creates[0].data.estimatedDurationMinutes).toBe(38); });
  it("falls back to provider ETA when ML prediction fails", async () => { const { store } = createStore(); const model: LogisticsModel = { predictDispatch: () => { throw new Error("offline"); }, predictEta: () => { throw new Error("offline"); } }; const response = await request(createApp({ store, authenticate, deliveryQuoteConfig: config, distanceProvider: { calculate: async () => ({ distanceKm: 3.4567, durationMinutes: 25 }) }, mlModel: model, now: () => now })).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send(validBody); expect(response.status).toBe(201); expect(response.body.data).toMatchObject({ estimatedDurationMinutes: 25, etaAssistance: { mode: "DETERMINISTIC_FALLBACK", modelVersion: null, deterministicMinutes: 25, predictedMinutes: null } }); });

  it("rejects unauthenticated access", async () => {
    const response = await request(app(createStore().store)).post("/api/v1/delivery-quotes").send(validBody);
    expect(response.status).toBe(401); expect(response.body.code).toBe("AUTH_REQUIRED");
  });
  it("enforces the CUSTOMER role", async () => {
    const response = await request(app(createStore().store)).post("/api/v1/delivery-quotes").set("Authorization", "Bearer rider").send(validBody);
    expect(response.status).toBe(403); expect(response.body.code).toBe("FORBIDDEN");
  });
  it("rejects an inactive customer", async () => {
    const response = await request(app(createStore({ customerActive: false }).store)).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send(validBody);
    expect(response.status).toBe(403); expect(response.body.code).toBe("CUSTOMER_INACTIVE");
  });
  it("treats an unowned address as not found", async () => {
    const { store, state } = createStore({ addressOwned: false });
    const response = await request(app(store)).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send(validBody);
    expect(response.status).toBe(404); expect(response.body.code).toBe("ADDRESS_NOT_FOUND");
    expect(state.addressQueries[0].where).toEqual({ id: addressId, userId: customerId });
    expect(state.creates).toHaveLength(0);
  });
  it("rejects missing destination coordinates", async () => {
    const response = await request(app(createStore({ addressCoordinates: false }).store)).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send(validBody);
    expect(response.status).toBe(422); expect(response.body.code).toBe("DESTINATION_COORDINATES_UNAVAILABLE");
  });
  it.each([
    { pharmacyExists: false }, { pharmacyActive: false }, { pharmacyVerified: false }, { partnerStatus: "SUSPENDED" },
  ] satisfies StoreOptions[])("rejects unavailable or ineligible pharmacies", async (options) => {
    const response = await request(app(createStore(options).store)).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send(validBody);
    expect(response.status).toBe(422); expect(response.body.code).toBe("PHARMACY_INELIGIBLE");
  });
  it("rejects missing pharmacy coordinates", async () => {
    const response = await request(app(createStore({ pharmacyCoordinates: false }).store)).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send(validBody);
    expect(response.status).toBe(422); expect(response.body.code).toBe("PHARMACY_COORDINATES_UNAVAILABLE");
  });
  it.each([
    { pharmacyId: "not-a-uuid", deliveryAddressId: addressId },
    { pharmacyId, deliveryAddressId: "not-a-uuid" },
  ])("rejects invalid UUIDs", async (body) => {
    const response = await request(app(createStore().store)).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send(body);
    expect(response.status).toBe(400); expect(response.body.code).toBe("INVALID_QUOTE_REQUEST");
  });
  it.each(["distanceKm", "finalDeliveryFee", "demandAdjustment", "customerId"])("rejects client-controlled field %s", async (field) => {
    const response = await request(app(createStore().store)).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send({ ...validBody, [field]: field === "customerId" ? otherCustomerId : 1 });
    expect(response.status).toBe(400); expect(response.body.code).toBe("INVALID_QUOTE_REQUEST");
  });
  it("maps provider failure without creating a quote", async () => {
    const { store, state } = createStore();
    const failingProvider: DistanceProvider = { calculate: async () => {
      expect(state.activeTransactions).toBe(0);
      state.events.push("provider:failure");
      throw new Error("routing unavailable");
    } };
    const response = await request(app(store, authenticate, failingProvider)).post("/api/v1/delivery-quotes").set("Authorization", "Bearer customer").send(validBody);
    expect(response.status).toBe(502); expect(response.body.code).toBe("DISTANCE_PROVIDER_FAILED"); expect(state.creates).toHaveLength(0);
    expect(state.events).toEqual(["transaction:start", "transaction:end", "provider:failure"]);
  });
  it("uses the Platform Core authentication boundary by default", async () => {
    const response = await request(createApp({ store: createStore().store, deliveryQuoteConfig: config, distanceProvider: provider }))
      .post("/api/v1/delivery-quotes").send(validBody);
    expect(response.status).toBe(401); expect(response.body.code).toBe("AUTH_REQUIRED");
  });
});
