import assert from "node:assert/strict";
import test from "node:test";
import {
  composeIntelligenceModule,
  createTrustedAssistantContext,
  createUnavailableIntelligenceDependencies,
  routeAssistantRequest,
  ToolRegistry,
} from "../src/modules/intelligence-experience/index.js";

const context = createTrustedAssistantContext(
  { userId: "server-authenticated-user", roles: ["CUSTOMER"] },
  "request-1",
);

test("routes an allowed operational medicine discovery intent", () => {
  assert.equal(routeAssistantRequest({ message: "Find Crocin near me", channel: "text" }).intent, "medicine_discovery");
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
        return { status: "success", data: {} };
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
        return { status: "success", data: {} };
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
        return { status: "success", data: {} };
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
  assert.deepEqual(receivedInput, { orderId: undefined, category: "delayed delivery", details: message });
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
