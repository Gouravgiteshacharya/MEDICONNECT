import type {
  AssistantIntent,
  AssistantRequest,
  AssistantResponse,
  TrustedAssistantContext,
} from "./contracts.js";
import { routeAssistantRequest } from "./routing.js";
import { evaluateAssistantSafety } from "./safety-policy.js";
import { ToolRegistry } from "./tool-registry.js";

export class DeterministicAssistant {
  readonly #tools: ToolRegistry;

  constructor(tools: ToolRegistry) {
    this.#tools = tools;
  }

  async respond(
    request: AssistantRequest,
    context: TrustedAssistantContext,
  ): Promise<AssistantResponse> {
    if (!request.message.trim()) {
      return {
        status: "error",
        intent: "unknown",
        message: "Please enter a request.",
        suggestedActions: [],
        toolResult: { status: "error", code: "invalid_request", message: "Message is required." },
      };
    }

    const route = routeAssistantRequest(request);
    const safety = evaluateAssistantSafety(route.intent);
    if (!safety.allowed) {
      return {
        status: "refused",
        intent: route.intent,
        message: safety.message,
        suggestedActions: safety.actions,
      };
    }

    if (route.intent === "prescription_workflow") {
      return {
        status: "fulfilled",
        intent: route.intent,
        message: "Open the prescription upload step from your cart or order and submit a clear image for human pharmacy review.",
        suggestedActions: [{ id: "open-prescription-upload", label: "Upload prescription", kind: "navigate" }],
      };
    }

    if (route.intent === "support_request" && "clarificationRequired" in route) {
      const result = {
        status: "error" as const,
        code: "invalid_request" as const,
        message: "Please specify whether the issue is about a delayed delivery, wrong order, missing item, payment, rider, pharmacy, or prescription.",
      };
      return { status: "error", intent: route.intent, message: result.message, suggestedActions: [], toolResult: result };
    }

    if (!("toolName" in route)) {
      return {
        status: "unsupported",
        intent: route.intent,
        message: "I can help you find a named medicine or pharmacy, explain prescription upload, check an order or prescription using its ID, track a delivery, or start a support request. I can't provide medical diagnosis, prescribing, or dosage advice.",
        suggestedActions: [],
      };
    }

    const result = await this.#tools.execute(route.toolName, route.toolInput, context);
    if (result.status === "error") {
      return {
        status: "error",
        intent: route.intent,
        message: result.message,
        suggestedActions: [],
        toolResult: result,
      };
    }

    return {
      status: "fulfilled",
      intent: route.intent,
      message: successMessage(route.intent),
      suggestedActions: [],
      toolResult: result,
    };
  }
}

function successMessage(intent: AssistantIntent): string {
  const messages: Partial<Record<AssistantIntent, string>> = {
    medicine_discovery: "Medicine availability information was retrieved.",
    pharmacy_discovery: "Pharmacy availability information was retrieved.",
    order_status: "Your order information was retrieved.",
    prescription_status: "Your prescription review information was retrieved.",
    delivery_tracking: "Delivery tracking information was retrieved.",
    support_request: "Your support request was submitted.",
  };
  return messages[intent] ?? "The MediConnect request was completed.";
}
