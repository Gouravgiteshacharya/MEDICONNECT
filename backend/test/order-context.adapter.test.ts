import assert from "node:assert/strict";
import { FulfillmentMethod, OrderStatus, PrescriptionStatus, Prisma } from "../generated/prisma/client.js";
import { describe, test } from "vitest";
import { createOrderContextAdapter, createTrustedAssistantContext, type OrderContextDependencies } from "../src/modules/intelligence-experience/index.js";
import { ApiError } from "../src/utils/ApiError.js";

const customerId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const context = createTrustedAssistantContext({ userId: customerId, roles: ["CUSTOMER"] }, "request-1");
const placedAt = new Date("2026-09-01T10:00:00.000Z");

function order() {
  return {
    id: orderId, orderNumber: "MC-1024", pharmacyId: "33333333-3333-4333-8333-333333333333",
    fulfillmentMethod: FulfillmentMethod.DELIVERY, status: OrderStatus.OUT_FOR_DELIVERY,
    medicineSubtotal: new Prisma.Decimal("20.00"), deliveryFee: new Prisma.Decimal("4.50"), totalAmount: new Prisma.Decimal("24.50"),
    deliveryAddressId: "44444444-4444-4444-8444-444444444444", deliveryAddressLabelSnapshot: "Home",
    deliveryAddressLine1Snapshot: "Private address", deliveryAddressLine2Snapshot: null, deliveryLandmarkSnapshot: null,
    deliveryCitySnapshot: "Bengaluru", deliveryStateSnapshot: "Karnataka", deliveryPostalCodeSnapshot: "560001",
    deliveryLatitudeSnapshot: 12.9, deliveryLongitudeSnapshot: 77.6, deliveryDistanceKm: 3.2, quotedEtaMinutes: 25,
    placedAt, confirmedAt: placedAt, completedAt: null, cancelledAt: null, createdAt: placedAt, updatedAt: placedAt,
    items: [{ id: "item-private", medicineId: "medicine-private", medicineNameSnapshot: "Crocin", brandNameSnapshot: "Crocin", manufacturerSnapshot: "Labs", requiresPrescription: true, quantity: 2, unitPrice: new Prisma.Decimal("10.00"), lineTotal: new Prisma.Decimal("20.00") }],
    prescriptions: [{ id: "prescription-private", orderId, fileUrl: "private-url", originalFilename: "private.pdf", status: PrescriptionStatus.PENDING_REVIEW, uploadedAt: placedAt, reviewedAt: null, reviewNotes: null, rejectionReason: null }],
  };
}

function dependency(operation: OrderContextDependencies["getCustomerOrder"]): OrderContextDependencies {
  return { getCustomerOrder: operation };
}

describe("order context adapter", () => {
  test("uses trusted identity and maps a JSON-safe customer DTO", async () => {
    let identity = "";
    let identifier = "";
    const adapter = createOrderContextAdapter(dependency(async (receivedCustomer, receivedId) => {
      identity = receivedCustomer; identifier = receivedId; return order();
    }));
    const result = await adapter.getOrder(` ${orderId} `, context);
    assert.equal(identity, customerId);
    assert.equal(identifier, orderId);
    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.deepEqual(result.data.order, {
      orderNumber: "MC-1024", status: "OUT_FOR_DELIVERY", fulfillmentMethod: "DELIVERY", totalAmount: "24.5",
      placedAt: placedAt.toISOString(), confirmedAt: placedAt.toISOString(), completedAt: null, cancelledAt: null, updatedAt: placedAt.toISOString(),
    });
    assert.deepEqual(result.data.items[0], { medicineName: "Crocin", brandName: "Crocin", requiresPrescription: true, quantity: 2, unitPrice: "10", lineTotal: "20" });
    assert.deepEqual(result.data.prescriptions[0], { status: "PENDING_REVIEW", uploadedAt: placedAt.toISOString(), reviewedAt: null, reviewNotes: null, rejectionReason: null });
    const serialized = JSON.stringify(result.data);
    for (const privateValue of [orderId, "item-private", "medicine-private", "prescription-private", "Private address", "deliveryLatitudeSnapshot", "quotedEtaMinutes"]) assert.equal(serialized.includes(privateValue), false);
  });

  test("rejects missing, malformed, and order-number identifiers before Commerce", async () => {
    let calls = 0;
    const adapter = createOrderContextAdapter(dependency(async () => { calls += 1; return order(); }));
    for (const value of ["", "not-a-uuid", "MC-1024"]) {
      const result = await adapter.getOrder(value, context);
      assert.equal(result.status, "error");
      if (result.status === "error") assert.equal(result.code, "invalid_request");
    }
    assert.equal(calls, 0);
  });

  test("preserves ownership-safe not-found and hides unexpected errors", async () => {
    const missing = await createOrderContextAdapter(dependency(async () => { throw new ApiError(404, "Order not found.", "ORDER_NOT_FOUND"); })).getOrder(orderId, context);
    assert.equal(missing.status, "error");
    if (missing.status === "error") assert.equal(missing.code, "not_found");
    const failed = await createOrderContextAdapter(dependency(async () => { throw new Error("private database failure"); })).getOrder(orderId, context);
    assert.deepEqual(failed, { status: "error", code: "execution_failed", message: "Order information could not be retrieved." });
  });
});
