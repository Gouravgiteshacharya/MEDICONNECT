import assert from "node:assert/strict";
import { test } from "vitest";
import {
  composeIntelligenceModule,
  createOrderContextAdapter,
  createTrustedAssistantContext,
  createUnavailableIntelligenceDependencies,
  extractMedicineName,
  routeAssistantRequest,
  ToolRegistry,
} from "../src/modules/intelligence-experience/index.js";

const context = createTrustedAssistantContext(
  { userId: "server-authenticated-user", roles: ["CUSTOMER"] },
  "request-1",
);

const orderStatusData = {
  order: {
    orderNumber: "MC-TEST",
    status: "CONFIRMED" as const,
    fulfillmentMethod: "DELIVERY" as const,
    totalAmount: "20.00",
    placedAt: "2026-09-01T10:00:00.000Z",
    confirmedAt: "2026-09-01T10:05:00.000Z",
    completedAt: null,
    cancelledAt: null,
    updatedAt: "2026-09-01T10:05:00.000Z",
  },
  items: [],
  prescriptions: [],
};

const deliveryTrackingData = {
  order: { orderNumber: "MC-TEST", status: "PREPARING" as const },
  delivery: { assignmentStatus: null, quotedEtaMinutes: null },
  events: [],
};

const prescriptionStatusData = {
  prescription: {
    status: "PENDING_REVIEW" as const,
    uploadedAt: "2026-09-01T10:00:00.000Z",
    reviewedAt: null,
    reviewNotes: null,
    rejectionReason: null,
  },
};

test("routes an allowed operational medicine discovery intent", () => {
  assert.equal(routeAssistantRequest({ message: "Find Crocin near me", channel: "text" }).intent, "medicine_discovery");
});

test("help-me wording falls through to named medicine discovery", () => {
  assert.equal(routeAssistantRequest({ message: "Help me find Crocin near me", channel: "text" }).intent, "medicine_discovery");
});

test("extracts clearly named medicines from supported discovery phrases", () => {
  assert.equal(extractMedicineName("Find Crocin near me"), "Crocin");
  assert.equal(extractMedicineName("Search for Dolo 650"), "Dolo 650");
  assert.equal(extractMedicineName("Is Crocin available?"), "Crocin");
  assert.equal(extractMedicineName("Check stock for Crocin"), "Crocin");
});

test("classifies a prohibited clinical decision by requested action", () => {
  assert.equal(routeAssistantRequest({ message: "What medicine should I take for chest pain?", channel: "text" }).intent, "clinical_decision");
  assert.equal(routeAssistantRequest({ message: "Find chest pain medicine near me", channel: "text" }).intent, "clinical_decision");
});

test("routes operational prescription review questions to prescription status", () => {
  for (const message of [
    "Check my prescription status",
    "Tell me if my prescription is pending",
    "What is the review status of my prescription?",
  ]) {
    assert.equal(routeAssistantRequest({ message, channel: "text" }).intent, "prescription_status");
  }
});

test("routes prohibited prescription judgments to clinical decision", () => {
  for (const message of [
    "Is my prescription medically safe?",
    "Is this prescription appropriate for me?",
    "Tell me if this prescription is medically correct",
    "Should this prescription be approved?",
    "Can you approve/reject my prescription?",
  ]) {
    assert.equal(routeAssistantRequest({ message, channel: "text" }).intent, "clinical_decision");
  }
});

test("refuses diagnosis, prescribing, dosage, and medicine-safety requests", async () => {
  let supportCalls = 0;
  const dependencies = createUnavailableIntelligenceDependencies();
  const assistant = composeIntelligenceModule({
    ...dependencies,
    support: { createSupportRequest: async () => { supportCalls += 1; return { status: "success", data: {} }; } },
  });

  for (const message of [
    "Find me cold medicine.",
    "Do I have the flu?",
    "Diagnose my headache.",
    "Prescribe antibiotics for me.",
    "What dose should I take?",
    "How many tablets should I take?",
    "Is this medicine safe for me?",
  ]) {
    const response = await assistant.respond({ message, channel: "text" }, context);
    assert.equal(response.intent, "clinical_decision", message);
    assert.equal(response.status, "refused", message);
  }
  assert.equal(supportCalls, 0);
});

test("routes prescription, order, and delivery requests with explicit IDs", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  const prescription = routeAssistantRequest({ message: `Is prescription #${id} still pending?`, channel: "text" });
  const order = routeAssistantRequest({ message: `What is the status of order #${id}?`, channel: "text" });
  const delivery = routeAssistantRequest({ message: `Track order #${id}`, channel: "text" });

  assert.equal(prescription.intent, "prescription_status");
  assert.equal(order.intent, "order_status");
  assert.equal(delivery.intent, "delivery_tracking");
  if ("toolInput" in prescription) assert.equal(prescription.toolInput.prescriptionId, id);
  if ("toolInput" in order) assert.equal(order.toolInput.orderId, id);
  if ("toolInput" in delivery) assert.equal(delivery.toolInput.orderId, id);
});

test("routes explicit pharmacy discovery through the discovery tool", () => {
  for (const message of ["Find pharmacies near me", "Show nearby pharmacies"]) {
    const route = routeAssistantRequest({ message, channel: "text" });
    assert.equal(route.intent, "pharmacy_discovery");
    if ("toolName" in route) assert.equal(route.toolName, "medicine.discovery");
  }
});

test("help-me wording falls through to pharmacy discovery", () => {
  assert.equal(routeAssistantRequest({ message: "Help me find a pharmacy nearby", channel: "text" }).intent, "pharmacy_discovery");
});

test("classifies clear support issues into fixed categories", () => {
  const cases = [
    ["my order is late", "DELAYED_DELIVERY"],
    ["my order has the wrong items", "WRONG_ORDER"],
    ["an item is missing from my order", "MISSING_ITEM"],
    ["I have a payment issue", "PAYMENT"],
    ["I have an issue with the rider", "RIDER"],
    ["I have a pharmacy issue", "PHARMACY"],
    ["I have a prescription support issue", "PRESCRIPTION"],
  ] as const;

  for (const [message, category] of cases) {
    const route = routeAssistantRequest({ message, channel: "text" });
    assert.equal(route.intent, "support_request", message);
    assert.equal("toolName" in route, true, message);
    if ("toolInput" in route) assert.equal(route.toolInput.category, category, message);
  }
});

test("returns a deterministic safe refusal without creating support work", async () => {
  let supportCalls = 0;
  const dependencies = createUnavailableIntelligenceDependencies();
  const assistant = composeIntelligenceModule({
    ...dependencies,
    support: {
      createSupportRequest: async () => {
        supportCalls += 1;
        return { status: "success", data: {} };
      },
    },
  });

  const response = await assistant.respond(
    { message: "How many tablets should I take?", channel: "text" },
    context,
  );

  assert.equal(response.status, "refused");
  assert.match(response.message, /doctor or pharmacist/i);
  assert.equal(supportCalls, 0);
});

test("propagates explicit adapter unavailable behavior without fabricated data", async () => {
  const assistant = composeIntelligenceModule(createUnavailableIntelligenceDependencies());
  const response = await assistant.respond({ message: "Find Crocin near me", channel: "text" }, context);

  assert.equal(response.status, "error");
  assert.deepEqual(response.toolResult, {
    status: "error",
    code: "unavailable",
    message: "Medicine discovery is currently unavailable.",
  });
});

test("AI-provider absence does not break deterministic behavior", async () => {
  const assistant = composeIntelligenceModule(createUnavailableIntelligenceDependencies());
  const response = await assistant.respond(
    { message: "How do I upload my prescription?", channel: "text" },
    context,
  );

  assert.equal(response.status, "fulfilled");
  assert.equal(response.intent, "prescription_workflow");
});

test("registers and executes a tool using trusted server context", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "identity.echo",
    description: "Test trusted context propagation.",
    execute: async (_input, trusted) => ({ status: "success", data: trusted.userId }),
  });

  const result = await registry.execute("identity.echo", { userId: "spoofed-user" }, context);
  assert.deepEqual(result, { status: "success", data: "server-authenticated-user" });
  assert.throws(() => registry.register({ name: "identity.echo", description: "duplicate", execute: async () => ({ status: "success", data: null }) }));
});

test("assistant request contract has no trusted identity fields", () => {
  const frontendPayload = { message: "Find Crocin", channel: "text", userId: "spoofed", role: "ADMIN" } as const;
  const route = routeAssistantRequest(frontendPayload);
  assert.equal(route.intent, "medicine_discovery");
  assert.equal(context.userId, "server-authenticated-user");
  assert.deepEqual(context.roles, ["CUSTOMER"]);
});

test("missing order ID returns invalid_request without calling the order adapter", async () => {
  let calls = 0;
  const dependencies = createUnavailableIntelligenceDependencies();
  const assistant = composeIntelligenceModule({
    ...dependencies,
    orderContext: {
      getOrder: async () => {
        calls += 1;
        return { status: "success", data: orderStatusData };
      },
    },
  });

  const response = await assistant.respond({ message: "order status", channel: "text" }, context);
  assert.equal(response.toolResult?.status, "error");
  if (response.toolResult?.status === "error") assert.equal(response.toolResult.code, "invalid_request");
  assert.equal(calls, 0);
});

test("missing prescription ID returns invalid_request without calling the prescription adapter", async () => {
  let calls = 0;
  const dependencies = createUnavailableIntelligenceDependencies();
  const assistant = composeIntelligenceModule({
    ...dependencies,
    prescriptionContext: {
      getPrescriptionStatus: async () => {
        calls += 1;
        return { status: "success", data: prescriptionStatusData };
      },
    },
  });

  const response = await assistant.respond({ message: "prescription status", channel: "text" }, context);
  assert.equal(response.toolResult?.status, "error");
  if (response.toolResult?.status === "error") assert.equal(response.toolResult.code, "invalid_request");
  assert.equal(calls, 0);
});

test("missing delivery order ID returns invalid_request without calling the delivery adapter", async () => {
  let calls = 0;
  const dependencies = createUnavailableIntelligenceDependencies();
  const assistant = composeIntelligenceModule({
    ...dependencies,
    deliveryTracking: {
      getTracking: async () => {
        calls += 1;
        return { status: "success", data: deliveryTrackingData };
      },
    },
  });

  const response = await assistant.respond({ message: "track my delivery", channel: "text" }, context);
  assert.equal(response.toolResult?.status, "error");
  if (response.toolResult?.status === "error") assert.equal(response.toolResult.code, "invalid_request");
  assert.equal(calls, 0);
});

test("valid support request reaches the support adapter using trusted context", async () => {
  let receivedUserId: string | undefined;
  let receivedInput: Readonly<{ orderId?: string; category: string; details: string }> | undefined;
  const dependencies = createUnavailableIntelligenceDependencies();
  const assistant = composeIntelligenceModule({
    ...dependencies,
    support: {
      createSupportRequest: async (input, trusted) => {
        receivedInput = input;
        receivedUserId = trusted.userId;
        return { status: "success", data: { accepted: true } };
      },
    },
  });

  const message = "I need support. Category: delayed delivery.";
  const response = await assistant.respond({ message, channel: "text" }, context);

  assert.equal(response.status, "fulfilled");
  assert.deepEqual(receivedInput, { orderId: undefined, category: "DELAYED_DELIVERY", details: message });
  assert.equal(receivedUserId, "server-authenticated-user");
});

test("malformed support input returns invalid_request without calling the support adapter", async () => {
  let calls = 0;
  const dependencies = createUnavailableIntelligenceDependencies();
  const assistant = composeIntelligenceModule({
    ...dependencies,
    support: {
      createSupportRequest: async () => {
        calls += 1;
        return { status: "success", data: {} };
      },
    },
  });

  const response = await assistant.respond({ message: "I need support", channel: "text" }, context);

  assert.equal(response.toolResult?.status, "error");
  if (response.toolResult?.status === "error") assert.equal(response.toolResult.code, "invalid_request");
  assert.equal(calls, 0);
});

test("ambiguous support request asks for a category without creating a ticket", async () => {
  let calls = 0;
  const dependencies = createUnavailableIntelligenceDependencies();
  const assistant = composeIntelligenceModule({
    ...dependencies,
    support: { createSupportRequest: async () => { calls += 1; return { status: "success", data: {} }; } },
  });

  for (const message of ["I need support", "I have a complaint"]) {
    const response = await assistant.respond({ message, channel: "text" }, context);
    assert.equal(response.intent, "support_request");
    assert.equal(response.status, "error");
    assert.equal(response.toolResult?.status, "error");
    if (response.toolResult?.status === "error") assert.equal(response.toolResult.code, "invalid_request");
  }
  assert.equal(calls, 0);
});

test("unknown request returns deterministic help without a tool call", async () => {
  const assistant = composeIntelligenceModule(createUnavailableIntelligenceDependencies());
  const response = await assistant.respond({ message: "Tell me a joke", channel: "text" }, context);
  assert.equal(response.status, "unsupported");
  assert.equal(response.intent, "unknown");
  assert.match(response.message, /find a named medicine or pharmacy/i);
  assert.match(response.message, /can't provide medical diagnosis/i);
  assert.equal(response.toolResult, undefined);
});

test("registered tool errors remain authoritative", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "failure.explicit",
    description: "Returns an explicit domain failure.",
    execute: async () => ({ status: "error", code: "forbidden", message: "Access denied by the domain." }),
  });
  assert.deepEqual(await registry.execute("failure.explicit", {}, context), {
    status: "error",
    code: "forbidden",
    message: "Access denied by the domain.",
  });
});

test("thrown tool failures become execution_failed", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "failure.thrown",
    description: "Throws unexpectedly.",
    execute: async () => { throw new Error("private failure"); },
  });
  const result = await registry.execute("failure.thrown", {}, context);
  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "execution_failed");
});

test("successful tools receive intent-specific deterministic messages", async () => {
  const dependencies = createUnavailableIntelligenceDependencies();
  const assistant = composeIntelligenceModule({
    ...dependencies,
    medicineDiscovery: { discover: async () => ({ status: "success", data: {
      medicine: { name: "Crocin", brandName: null, genericName: "Paracetamol", requiresPrescription: false },
      pharmacies: [],
      radiusKm: 5,
    } }) },
    orderContext: { getOrder: async () => ({ status: "success", data: orderStatusData }) },
    prescriptionContext: { getPrescriptionStatus: async () => ({ status: "success", data: prescriptionStatusData }) },
    deliveryTracking: { getTracking: async () => ({ status: "success", data: deliveryTrackingData }) },
    support: { createSupportRequest: async () => ({ status: "success", data: {} }) },
  });
  const id = "33333333-3333-4333-8333-333333333333";
  const cases = [
    ["Find Crocin near me", "Crocin was found, but no eligible pharmacy within 5 km currently reports it as available."],
    ["Find pharmacies near me", "Pharmacy availability information was retrieved."],
    [`Order status for order ID ${id}`, "Order MC-TEST has been confirmed."],
    [`Prescription status for prescription ID ${id}`, "Your prescription is pending pharmacy review."],
    [`Track order #${id}`, "Order MC-TEST is being prepared."],
    ["my order is late", "Your support request was submitted."],
  ] as const;

  for (const [message, expected] of cases) {
    const response = await assistant.respond({ message, channel: "text" }, context);
    assert.equal(response.status, "fulfilled", message);
    assert.equal(response.message, expected, message);
  }
});

test("routes strict bare UUID operational lookup forms", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  const order = routeAssistantRequest({ message: `Check order ${id}`, channel: "text" });
  const prescription = routeAssistantRequest({ message: `Check prescription ${id}`, channel: "text" });
  assert.equal(order.intent, "order_status");
  assert.equal(prescription.intent, "prescription_status");
  if ("toolInput" in order) assert.equal(order.toolInput.orderId, id);
  if ("toolInput" in prescription) assert.equal(prescription.toolInput.prescriptionId, id);
});

test("summarizes authoritative order states and preserves structured results", async () => {
  const dependencies = createUnavailableIntelligenceDependencies();
  const id = "33333333-3333-4333-8333-333333333333";
  for (const [status, expected] of [
    ["DELIVERED", "Order MC-TEST was delivered."],
    ["CONFIRMED", "Order MC-TEST has been confirmed."],
    ["PRESCRIPTION_PENDING", "Order MC-TEST is awaiting prescription review."],
  ] as const) {
    const data = { ...orderStatusData, order: { ...orderStatusData.order, status } };
    const assistant = composeIntelligenceModule({
      ...dependencies,
      orderContext: { getOrder: async () => ({ status: "success", data }) },
    });
    const response = await assistant.respond({ message: `Order status for order ID ${id}`, channel: "text" }, context);
    assert.equal(response.message, expected);
    assert.deepEqual(response.toolResult, { status: "success", data });
  }
});

test("summarizes recorded prescription states and rejection reason", async () => {
  const dependencies = createUnavailableIntelligenceDependencies();
  const id = "33333333-3333-4333-8333-333333333333";
  for (const [status, reason, expected] of [
    ["PENDING_REVIEW", null, "Your prescription is pending pharmacy review."],
    ["APPROVED", null, "Your prescription was approved through the pharmacy review process."],
    ["REJECTED", "Image unclear", "Your prescription was rejected through the pharmacy review process. Recorded reason: Image unclear"],
    ["ADDITIONAL_INFO_REQUIRED", null, "The pharmacy requested additional prescription information."],
  ] as const) {
    const data = { prescription: { ...prescriptionStatusData.prescription, status, rejectionReason: reason } };
    const assistant = composeIntelligenceModule({
      ...dependencies,
      prescriptionContext: { getPrescriptionStatus: async () => ({ status: "success", data }) },
    });
    const response = await assistant.respond({ message: `Prescription status for prescription ID ${id}`, channel: "text" }, context);
    assert.equal(response.message, expected);
    assert.deepEqual(response.toolResult, { status: "success", data });
  }
});

test("rejects malformed and customer order-number lookups before Commerce", async () => {
  let calls = 0;
  const dependencies = createUnavailableIntelligenceDependencies();
  const assistant = composeIntelligenceModule({
    ...dependencies,
    orderContext: createOrderContextAdapter({ getCustomerOrder: async () => { calls += 1; throw new Error("must not run"); } }),
  });
  for (const message of ["Order status for order ID bad-id", "Order status for order number MC-1024", "Order status for order # MC-1024"]) {
    const response = await assistant.respond({ message, channel: "text" }, context);
    assert.equal(response.status, "error");
    assert.equal(response.toolResult?.status, "error");
    if (response.toolResult?.status === "error") assert.equal(response.toolResult.code, "invalid_request");
  }
  assert.equal(calls, 0);
});

test("clinical prescription judgments are refused without prescription execution", async () => {
  let calls = 0;
  const dependencies = createUnavailableIntelligenceDependencies();
  const assistant = composeIntelligenceModule({
    ...dependencies,
    prescriptionContext: { getPrescriptionStatus: async () => { calls += 1; return { status: "success", data: prescriptionStatusData }; } },
  });
  for (const message of ["Should this prescription be approved?", "Can you approve this prescription?", "Is this prescription safe for me?", "Should I take the medicine on this prescription?"]) {
    const response = await assistant.respond({ message, channel: "text" }, context);
    assert.equal(response.status, "refused", message);
  }
  assert.equal(calls, 0);
});


test("Delivery forms use domain-compatible UUIDs while ordinary order forms stay Commerce", () => {
  const id = "10000000-0000-0000-0000-000000000001";
  for (const message of [
    `Track order ID ${id}`, `Track order ${id}`, `Where is order ID ${id}?`,
    `Where is my order ID ${id}?`, `Delivery tracking for order ID ${id}`,
    `What is the delivery status of order ID ${id}?`,
  ]) {
    const route = routeAssistantRequest({ message, channel: "text" });
    assert.equal(route.intent, "delivery_tracking", message);
    if ("toolInput" in route) assert.equal(route.toolInput.orderId, id);
  }
  for (const message of [`What is the status of order ID ${id}?`, `Check order ID 33333333-3333-4333-8333-333333333333`, `Order status for order ID ${id}`]) {
    assert.equal(routeAssistantRequest({ message, channel: "text" }).intent, "order_status", message);
  }
});

test("Delivery summaries respect terminal/failure precedence and preserve structured results", async () => {
  const cases = [
    ["DELIVERED", "FAILED", "Order MC-TEST has been delivered."],
    ["CANCELLED", "OUT_FOR_DELIVERY", "Order MC-TEST has been cancelled."],
    ["REJECTED_BY_PHARMACY", "ACCEPTED", "Order MC-TEST was rejected by the pharmacy."],
    ["OUT_FOR_DELIVERY", "FAILED", "A delivery attempt for order MC-TEST failed."],
    ["OUT_FOR_DELIVERY", "OUT_FOR_DELIVERY", "Order MC-TEST is out for delivery. The quoted delivery ETA was 35 minutes."],
    ["PICKED_UP", "PICKED_UP", "Order MC-TEST has been picked up from the pharmacy. The quoted delivery ETA was 35 minutes."],
    ["RIDER_ASSIGNED", "ACCEPTED", "A rider has been assigned to order MC-TEST. The quoted delivery ETA was 35 minutes."],
    ["PREPARING", null, "Order MC-TEST is being prepared. The quoted delivery ETA was 35 minutes."],
    ["READY_FOR_PICKUP", null, "Order MC-TEST is ready for pickup by a rider. The quoted delivery ETA was 35 minutes."],
    ["PRESCRIPTION_PENDING", null, "Order MC-TEST is currently PRESCRIPTION_PENDING."],
    ["CONFIRMED", null, "Order MC-TEST is currently CONFIRMED."],
  ] as const;
  for (const [status, assignmentStatus, expected] of cases) {
    const data = { order: { orderNumber: "MC-TEST", status }, delivery: { assignmentStatus, quotedEtaMinutes: 35 }, events: [] };
    const result = { status: "success" as const, data };
    const assistant = composeIntelligenceModule({ ...createUnavailableIntelligenceDependencies(), deliveryTracking: { getTracking: async () => result } });
    const response = await assistant.respond({ message: "Track order ID 10000000-0000-0000-0000-000000000001", channel: "text" }, context);
    assert.equal(response.message, expected);
    assert.equal(response.toolResult, result);
  }
});

test("null delivery ETA produces no ETA sentence", async () => {
  const assistant = composeIntelligenceModule({ ...createUnavailableIntelligenceDependencies(), deliveryTracking: { getTracking: async () => ({ status: "success", data: deliveryTrackingData }) } });
  const response = await assistant.respond({ message: "Track order ID 10000000-0000-0000-0000-000000000001", channel: "text" }, context);
  assert.equal(response.message, "Order MC-TEST is being prepared.");
});

test("malformed delivery identifiers do not invoke even an injected adapter", async () => {
  let calls = 0;
  const assistant = composeIntelligenceModule({ ...createUnavailableIntelligenceDependencies(), deliveryTracking: { getTracking: async () => { calls++; return { status: "success", data: deliveryTrackingData }; } } });
  for (const message of ["Track my delivery", "Track order ID bad-id", "Track order number MC-1024", "Track order MC-1024", "Track order random-token", "Track order 10000000-0000-0000-0000-000000000001-extra"]) {
    const response = await assistant.respond({ message, channel: "text" }, context);
    assert.equal(response.toolResult?.status, "error", message);
    if (response.toolResult?.status === "error") assert.equal(response.toolResult.code, "invalid_request", message);
  }
  assert.equal(calls, 0);
});

test("clinical delivery requests are refused before Delivery execution", async () => {
  let calls = 0;
  const assistant = composeIntelligenceModule({ ...createUnavailableIntelligenceDependencies(), deliveryTracking: { getTracking: async () => { calls++; return { status: "success", data: deliveryTrackingData }; } } });
  for (const message of [
    "My delivery is late. What medicine should I take for my fever?",
    "Track my delivery and recommend a medicine for pain",
    "How many tablets should I take of the delivered medicine?",
    "Is this medicine safe for me? Track my order",
    "Should this prescription be approved? Where is my order?",
    "What treatment should I use while my delivery is late?",
  ]) {
    const response = await assistant.respond({ message, channel: "text" }, context);
    assert.equal(response.intent, "clinical_decision", message);
    assert.equal(response.status, "refused", message);
  }
  assert.equal(calls, 0);
});

test("Support remains explicitly unavailable", async () => {
  const response = await composeIntelligenceModule().respond({ message: "My order is late", channel: "text" }, context);
  assert.equal(response.intent, "support_request");
  assert.deepEqual(response.toolResult, { status: "error", code: "unavailable", message: "Customer support is currently unavailable." });
});


test("text and voice channels use identical deterministic routing and safety", async () => {
  let calls = 0;
  const assistant = composeIntelligenceModule({
    ...createUnavailableIntelligenceDependencies(),
    deliveryTracking: { getTracking: async () => { calls++; return { status: "success", data: deliveryTrackingData }; } },
  });
  for (const message of ["Track order ID 10000000-0000-0000-0000-000000000001", "What dose should I take?"]) {
    const before = calls;
    const text = await assistant.respond({ message, channel: "text" }, context);
    const voice = await assistant.respond({ message, channel: "voice" }, context);
    assert.deepEqual(voice, text);
    assert.equal(calls - before, text.status === "refused" ? 0 : 2);
  }
});
