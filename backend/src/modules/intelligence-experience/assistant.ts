import type {
  AIProvider,
  AssistantRequest,
  AssistantResponse,
  TrustedAssistantContext,
} from "./contracts.js";
import { routeAssistantRequest } from "./routing.js";
import { evaluateAssistantSafety } from "./safety-policy.js";
import { ToolRegistry } from "./tool-registry.js";

export class DeterministicAssistant {
  readonly #tools: ToolRegistry;
  readonly #aiProvider?: AIProvider;

  constructor(tools: ToolRegistry, aiProvider?: AIProvider) {
    this.#tools = tools;
    this.#aiProvider = aiProvider;
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

    if (!("toolName" in route)) {
      return {
        status: "unsupported",
        intent: route.intent,
        message: "I can help with medicine and pharmacy discovery, orders, prescriptions, delivery tracking, and customer support.",
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
      message: "The requested MediConnect information was retrieved successfully.",
      suggestedActions: [],
      toolResult: result,
    };
  }
}
