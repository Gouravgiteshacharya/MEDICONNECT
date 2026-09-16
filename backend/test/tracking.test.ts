import { RiskTestStore } from "./risk-test-store.js";
import { OperationalRiskService } from "../src/risk/risk.service.js";
import { createRiskHooks } from "../src/risk/risk.hooks.js";
import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { UserRole } from "../src/auth/authenticator.js";
import type { TrackingStore } from "../src/customer-tracking/tracking.service.js";
const orderId = "10000000-0000-4000-8000-000000000001";
const customerId = "20000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-31T12:00:00Z");
function authentication(users: Record<string, { userId: string; role: UserRole }>): RequestHandler { return (req, _res, next) => { const token = req.header("authorization")?.replace(/^Bearer /, ""); if (token && users[token]) req.user = { id: users[token].userId, role: users[token].role }; next(); }; }
const authenticate = authentication({ customer: { userId: customerId, role: "CUSTOMER" }, rider: { userId: customerId, role: "DELIVERY_PARTNER" } });
interface Options { owned?: boolean; fulfillment?: string; orderStatus?: string; assignment?: boolean; assignmentStatus?: string; stale?: boolean; invalidCoordinates?: boolean; invalidDestination?: boolean; }
function createStore(options: Options = {}) {
  const queries: any[] = [];
  const assignment = options.assignment === false ? [] : [{
    id: "30000000-0000-4000-8000-000000000001", status: options.assignmentStatus ?? "OUT_FOR_DELIVERY", assignedAt: new Date(now.getTime() - 20_000), acceptedAt: new Date(now.getTime() - 19_000), pickedUpAt: new Date(now.getTime() - 10_000), deliveredAt: null,
    rider: { id: "40000000-0000-4000-8000-000000000001", currentLatitude: options.invalidCoordinates ? 91 : 28.62, currentLongitude: 77.21, lastLocationAt: new Date(now.getTime() - (options.stale ? 61_000 : 5_000)), user: { name: "Rahul S.", phone: "9999999999" } },
  }];
  const order = { id: orderId, orderNumber: "MED-1", status: options.orderStatus ?? "OUT_FOR_DELIVERY", fulfillmentMethod: options.fulfillment ?? "DELIVERY", quotedEtaMinutes: 25, deliveryLatitudeSnapshot: options.invalidDestination ? 100 : 28.65, deliveryLongitudeSnapshot: 77.23, deliveryAssignments: assignment,
    deliveryEvents: [{ eventType: "RIDER_ASSIGNED", occurredAt: new Date(now.getTime() - 20_000), note: "internal", metadata: { secret: true } }, { eventType: "OUT_FOR_DELIVERY", occurredAt: new Date(now.getTime() - 5_000) }] };
  const store: TrackingStore = { order: { findFirst: async (args: any) => { queries.push(args); return options.owned === false || args.where.customerId !== customerId || args.where.id !== orderId ? null : order; } } };
  return { store, queries };
}
function app(store: TrackingStore, auth = authenticate) { return createApp({ store: store as any, authenticate: auth, now: () => now, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 }, assignmentConfig: { offerTimeoutMs: 30_000 }, dispatchConfig: { maxCandidates: 10, maxRadiusKm: 15, workloadPenaltyKm: 2 } }); }
describe("customer delivery tracking", () => {
  it("returns fresh location, safe rider details, distance and timeline", async () => {
    const state = createStore(); const response = await request(app(state.store)).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer");
    expect(response.status).toBe(200); expect(response.body.data).toMatchObject({ orderId, status: "OUT_FOR_DELIVERY", terminal: false, rider: { name: "Rahul S.", phone: "9999999999" }, location: { latitude: 28.62, longitude: 77.21 }, locationFreshness: "FRESH" });
    expect(response.body.data.remainingDistanceKm).toBeGreaterThan(0); expect(response.body.data.timeline[0]).toEqual({ eventType: "RIDER_ASSIGNED", occurredAt: new Date(now.getTime() - 20_000).toISOString() });
    expect(state.queries[0].where).toEqual({ id: orderId, customerId });
  });
  it("withholds stale coordinates but reports freshness and last update", async () => {
    const response = await request(app(createStore({ stale: true }).store)).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer");
    expect(response.body.data.locationFreshness).toBe("STALE"); expect(response.body.data.location).toBeNull(); expect(response.body.data.remainingDistanceKm).toBeNull(); expect(response.body.data.lastUpdatedAt).not.toBeNull();
  });
  it.each(["DELIVERED", "CANCELLED", "REJECTED_BY_PHARMACY"])("applies privacy cutoff for terminal status %s", async (orderStatus) => {
    const response = await request(app(createStore({ orderStatus, assignmentStatus: orderStatus === "DELIVERED" ? "DELIVERED" : "FAILED" }).store)).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer");
    expect(response.body.data.terminal).toBe(true); expect(response.body.data.location).toBeNull(); expect(response.body.data.lastUpdatedAt).toBeNull(); expect(response.body.data.rider.phone).toBeNull();
  });
  it("ends location sharing for a failed assignment awaiting review", async () => {
    const response = await request(app(createStore({ assignmentStatus: "FAILED" }).store)).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer");
    expect(response.body.data.terminal).toBe(false); expect(response.body.data.location).toBeNull(); expect(response.body.data.rider.phone).toBeNull();
  });
  it("returns order progress before assignment", async () => {
    const response = await request(app(createStore({ assignment: false, orderStatus: "READY_FOR_PICKUP" }).store)).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer");
    expect(response.status).toBe(200); expect(response.body.data.assignment).toBeNull(); expect(response.body.data.rider).toBeNull(); expect(response.body.data.locationFreshness).toBe("UNAVAILABLE");
  });
  it("does not reveal another customer's order", async () => {
    const response = await request(app(createStore({ owned: false }).store)).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer"); expect(response.status).toBe(404); expect(response.body.code).toBe("ORDER_NOT_FOUND");
  });
  it("rejects self-pickup tracking", async () => {
    const response = await request(app(createStore({ fulfillment: "SELF_PICKUP" }).store)).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer"); expect(response.status).toBe(409); expect(response.body.code).toBe("TRACKING_NOT_AVAILABLE");
  });
  it("requires customer authentication and validates IDs", async () => {
    const unauth = await request(app(createStore().store)).get(`/api/v1/orders/${orderId}/tracking`); const forbidden = await request(app(createStore().store)).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer rider"); const invalid = await request(app(createStore().store)).get("/api/v1/orders/bad/tracking").set("Authorization", "Bearer customer");
    expect(unauth.status).toBe(401); expect(forbidden.status).toBe(403); expect(invalid.status).toBe(400);
  });
  it("withholds invalid rider coordinates", async () => {
    const response = await request(app(createStore({ invalidCoordinates: true }).store)).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer"); expect(response.body.data.location).toBeNull(); expect(response.body.data.locationFreshness).toBe("UNAVAILABLE");
  });
  it("keeps a valid rider location when only destination coordinates are invalid", async () => {
    const response = await request(app(createStore({ invalidDestination: true }).store)).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer");
    expect(response.body.data.locationFreshness).toBe("FRESH"); expect(response.body.data.location).toEqual({ latitude: 28.62, longitude: 77.21 }); expect(response.body.data.remainingDistanceKm).toBeNull();
  });
  it("uses the default authentication boundary", async () => {
    const response = await request(createApp({ store: createStore().store as any, locationConfig: { sampleIntervalMs: 15_000, freshnessThresholdMs: 60_000 }, assignmentConfig: { offerTimeoutMs: 30_000 }, dispatchConfig: { maxCandidates: 10, maxRadiusKm: 15, workloadPenaltyKm: 2 } })).get(`/api/v1/orders/${orderId}/tracking`); expect(response.status).toBe(401); expect(response.body.code).toBe("AUTH_REQUIRED");
  });
});


describe("tracking post-read stale-risk detection", () => {
  it("records stale active assignment after the authorized read without changing response", async () => {
    const state = createStore({ stale: true }); const riskStore = new RiskTestStore(); const service = new OperationalRiskService(riskStore.repository());
    let readCompleted = false; const read = state.store.order.findFirst;
    state.store.order.findFirst = async args => { const result = await read(args); readCompleted = true; return result; };
    const original = service.recordDetection.bind(service);
    const recorded = vi.spyOn(service, "recordDetection").mockImplementation(input => { expect(readCompleted).toBe(true); return original(input); });
    const application = createApp({ store: state.store as any, authenticate, riskService: service, now: () => now, locationConfig: { sampleIntervalMs: 15000, freshnessThresholdMs: 60000 } });
    const response = await request(application).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer");
    const baseline = await request(app(createStore({ stale: true }).store)).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer");
    expect(response.status).toBe(200); expect(response.body).toEqual(baseline.body); expect(recorded).toHaveBeenCalledTimes(1); expect(riskStore.rows.size).toBe(1);
    expect(JSON.stringify(recorded.mock.calls)).not.toMatch(/riderId|phone|name|latitude|longitude|address/);
    expect([...riskStore.rows.values()][0].entityType).toBe("DELIVERY_ASSIGNMENT");
  });
  it.each([{ stale: false }, { stale: true, assignmentStatus: "FAILED" }, { stale: true, assignmentStatus: "DELIVERED", orderStatus: "DELIVERED" }, { assignment: false }, { stale: true, orderStatus: "CANCELLED" }])("does not detect outside active stale observations: %j", async options => {
    const state = createStore(options); const riskStore = new RiskTestStore();
    const application = createApp({ store: state.store as any, authenticate, riskService: new OperationalRiskService(riskStore.repository()), now: () => now });
    expect((await request(application).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer")).status).toBe(200); expect(riskStore.creates).toBe(0);
  });
  it("risk error and observer rejection cannot fail the authorized read", async () => {
    const state = createStore({ stale: true }); const riskStore = new RiskTestStore(); riskStore.createError = new Error("private risk database error");
    const application = createApp({ store: state.store as any, authenticate, riskService: new OperationalRiskService(riskStore.repository()), onRiskHookError: async () => { throw new Error("observer rejected"); }, now: () => now });
    const response = await request(application).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer");
    expect(response.status).toBe(200); expect(response.body.data.locationFreshness).toBe("STALE"); expect(riskStore.creates).toBe(1);
  });
  it("unauthorized read performs no risk action", async () => {
    const state = createStore({ owned: false, stale: true }); const riskStore = new RiskTestStore();
    const application = createApp({ store: state.store as any, authenticate, riskService: new OperationalRiskService(riskStore.repository()), now: () => now });
    expect((await request(application).get(`/api/v1/orders/${orderId}/tracking`).set("Authorization", "Bearer customer")).status).toBe(404); expect(riskStore.creates).toBe(0);
  });
});
