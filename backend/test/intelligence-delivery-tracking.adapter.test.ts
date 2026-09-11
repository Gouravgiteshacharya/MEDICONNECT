import { describe, expect, it, vi } from "vitest";
import { createDeliveryTrackingAdapter } from "../src/modules/intelligence-experience/adapters/delivery-tracking.adapter.js";
import { composeIntelligenceModule, createTrustedAssistantContext, createUnavailableIntelligenceDependencies } from "../src/modules/intelligence-experience/index.js";
import type { CustomerTrackingReader } from "../src/customer-tracking/tracking.reader.js";
import { ApiError } from "../src/utils/ApiError.js";

const id = "10000000-0000-0000-0000-000000000001";
const context = createTrustedAssistantContext({ userId: "customer", roles: ["CUSTOMER"] }, "request");
const at = new Date("2026-09-01T12:00:00Z");
function record() {
  return {
    orderId: id, orderNumber: "MC-1024", status: "OUT_FOR_DELIVERY", terminal: false,
    quotedEtaMinutes: 35,
    assignment: { id: "private-assignment", status: "OUT_FOR_DELIVERY", assignedAt: at, acceptedAt: at, pickedUpAt: at, deliveredAt: null },
    rider: { name: "private-name", phone: "private-phone" },
    location: { latitude: 20, longitude: 70 }, locationFreshness: "FRESH" as const, remainingDistanceKm: 2, lastUpdatedAt: at,
    riderId: "private-rider", batchId: "private-batch", dispatchAttemptId: "private-dispatch",
    metadata: { rank: 1 },
    timeline: [
      { eventType: "RIDER_ASSIGNED", occurredAt: at, note: "private-note", metadata: { secret: true } },
      { eventType: "INTERNAL_EVENT", occurredAt: new Date(NaN) },
      { eventType: "OUT_FOR_DELIVERY", occurredAt: new Date(at.getTime() + 1000) },
    ],
  };
}
function setup() {
  const readTracking = vi.fn<CustomerTrackingReader>().mockResolvedValue(record());
  return { readTracking, adapter: createDeliveryTrackingAdapter({ readTracking }) };
}

describe("Delivery tracking adapter", () => {
  it.each([id, "33333333-3333-4333-8333-333333333333", "ABCDEF00-0000-F000-0000-000000000001"])("accepts Delivery UUID %s and passes trusted identity", async (orderId) => {
    const { adapter, readTracking } = setup();
    expect((await adapter.getTracking(` ${orderId} `, context)).status).toBe("success");
    expect(readTracking).toHaveBeenCalledExactlyOnceWith("customer", orderId);
  });
  it.each([undefined, "", "  ", "bad-id", "MC-1024", `${id}-extra`])("rejects invalid ID %s before reader execution", async (orderId) => {
    const { adapter, readTracking } = setup();
    expect(await adapter.getTracking(orderId as string, context)).toMatchObject({ status: "error", code: "invalid_request" });
    expect(readTracking).not.toHaveBeenCalled();
  });
  it.each([{ roles: [] }, { roles: ["ADMIN"] }, { roles: ["DELIVERY_PARTNER"] }])("rejects non-customer roles $roles", async ({ roles }) => {
    const { adapter, readTracking } = setup();
    expect(await adapter.getTracking(id, createTrustedAssistantContext({ userId: "customer", roles }, "r"))).toMatchObject({ code: "forbidden" });
    expect(readTracking).not.toHaveBeenCalled();
  });
  it("uses an exact DTO allowlist, ISO dates and authoritative event order", async () => {
    const { adapter } = setup();
    expect(await adapter.getTracking(id, context)).toEqual({ status: "success", data: {
      order: { orderNumber: "MC-1024", status: "OUT_FOR_DELIVERY" },
      delivery: { assignmentStatus: "OUT_FOR_DELIVERY", quotedEtaMinutes: 35 },
      events: [
        { type: "RIDER_ASSIGNED", occurredAt: at.toISOString() },
        { type: "OUT_FOR_DELIVERY", occurredAt: new Date(at.getTime() + 1000).toISOString() },
      ],
    } });
  });
  it("allows every documented operational timeline event", async () => {
    const { adapter, readTracking } = setup();
    const types = ["RIDER_ASSIGNED", "RIDER_ACCEPTED", "ARRIVED_AT_PHARMACY", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY", "REASSIGNED", "CANCELLED"];
    readTracking.mockResolvedValue({ ...record(), timeline: types.map((eventType) => ({ eventType, occurredAt: at })) });
    const result = await adapter.getTracking(id, context);
    expect(result.status === "success" && result.data.events.map((event) => event.type)).toEqual(types);
  });
  it("ignores spoofed request identity and role fields", async () => {
    const { adapter, readTracking } = setup();
    const assistant = composeIntelligenceModule({ ...createUnavailableIntelligenceDependencies(), deliveryTracking: adapter });
    const request = { message: `Track order ID ${id} customerId attacker userId attacker roles ADMIN`, channel: "text" as const, userId: "attacker", customerId: "attacker", roles: ["ADMIN"] };
    await assistant.respond(request, context);
    expect(readTracking).toHaveBeenCalledExactlyOnceWith("customer", id);
  });
  it.each(["missing", "cross-customer"])("preserves ownership-safe not_found for %s", async () => {
    const { adapter, readTracking } = setup();
    readTracking.mockRejectedValue(new ApiError(404, "private existence details", "ORDER_NOT_FOUND"));
    expect(await adapter.getTracking(id, context)).toEqual({ status: "error", code: "not_found", message: "Order not found." });
  });
  it.each(["TRACKING_NOT_AVAILABLE", "UNAVAILABLE", "SERVICE_UNAVAILABLE"])("maps %s to unavailable without raw text", async (code) => {
    const { adapter, readTracking } = setup();
    readTracking.mockRejectedValue(new ApiError(409, "private database details", code));
    expect(await adapter.getTracking(id, context)).toEqual({ status: "error", code: "unavailable", message: "Delivery tracking is currently unavailable." });
  });
  it.each([new Error("private SQL"), Object.assign(new Error("private connection"), { code: "P1001" })])("sanitizes unexpected failures", async (failure) => {
    const { adapter, readTracking } = setup(); readTracking.mockRejectedValue(failure);
    expect(await adapter.getTracking(id, context)).toEqual({ status: "error", code: "execution_failed", message: "Delivery tracking could not be retrieved." });
  });
  it("maps invalid domain dates to execution_failed", async () => {
    const { adapter, readTracking } = setup();
    readTracking.mockResolvedValue({ ...record(), timeline: [{ eventType: "DELIVERED", occurredAt: new Date(NaN) }] });
    expect(await adapter.getTracking(id, context)).toMatchObject({ code: "execution_failed" });
  });
  it("maps invalid domain status to execution_failed instead of exposing arbitrary data", async () => {
    const { adapter, readTracking } = setup(); readTracking.mockResolvedValue({ ...record(), status: "private-invalid-state" });
    expect(await adapter.getTracking(id, context)).toMatchObject({ code: "execution_failed" });
  });
});
