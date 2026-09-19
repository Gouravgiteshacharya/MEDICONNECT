import { describe, expect, it, vi } from "vitest";
import {
  createTrustedAssistantContext,
  type AIProvider,
  type AssistantRequest,
  type AssistantResponse,
  type OperationalReplyInput,
} from "../src/modules/intelligence-experience/contracts.js";
import { OperationalReplyEnhancer } from "../src/modules/intelligence-experience/operational-reply-enhancer.js";
import type { AssistantResponder } from "../src/modules/intelligence-experience/contracts.js";

const request: AssistantRequest = {
  message: "secret original customer text",
  channel: "text",
  correlationId: "secret-correlation",
};

const context = createTrustedAssistantContext(
  {
    userId: "secret-customer-id",
    roles: ["CUSTOMER"],
  },
  "secret-server-request-id",
);

function responder(response: AssistantResponse): AssistantResponder {
  return { respond: vi.fn().mockResolvedValue(response) };
}

function provider(
  implementation: (
    input: OperationalReplyInput,
  ) => ReturnType<AIProvider["generateOperationalReply"]>,
): AIProvider {
  return { generateOperationalReply: vi.fn(implementation) };
}

const medicineResponse: AssistantResponse = {
  status: "fulfilled",
  intent: "medicine_discovery",
  message:
    "Crocin is reported available at 1 pharmacy within 5 km. Some availability information was last updated more than 24 hours ago and may have changed.",
  suggestedActions: [],
  toolResult: {
    status: "success",
    data: {
      medicine: {
        name: "Crocin",
        brandName: "Sensitive Brand",
        genericName: "Sensitive Generic",
        requiresPrescription: false,
      },
      pharmacies: [
        {
          name: "Secret Pharmacy",
          address: {
            addressLine1: "Secret exact address",
            addressLine2: null,
            city: "Bhubaneswar",
            state: "Odisha",
            postalCode: "751001",
          },
          availability: "AVAILABLE",
          quantity: 42,
          sellingPrice: "99.99",
          distanceKm: 1.25,
          inventory: {
            freshness: "STALE",
            lastUpdated: "2026-09-19T00:00:00.000Z",
          },
        },
      ],
      radiusKm: 5,
    },
  },
};

describe("OperationalReplyEnhancer", () => {
  it("sends only allowlisted medicine-discovery facts to the provider", async () => {
    const generate = vi.fn().mockResolvedValue({
      status: "success",
      data: "Crocin availability was found nearby.",
    });
    const ai: AIProvider = { generateOperationalReply: generate };
    const assistant = new OperationalReplyEnhancer(responder(medicineResponse), ai);

    const result = await assistant.respond(request, context);

    expect(generate).toHaveBeenCalledWith({
      intent: "medicine_discovery",
      medicine: {
        name: "Crocin",
        reportingPharmacyCount: 1,
        radiusKm: 5,
        hasStaleAvailability: true,
        requiresPrescription: false,
      },
    });

    const providerPayload = JSON.stringify(generate.mock.calls[0]?.[0]);
    for (const secret of [
      request.message,
      request.correlationId!,
      "secret-customer-id",
      "secret-server-request-id",
      "Secret Pharmacy",
      "Secret exact address",
      "Sensitive Brand",
      "Sensitive Generic",
      "99.99",
      "42",
      "1.25",
      "751001",
    ]) {
      expect(providerPayload).not.toContain(secret);
    }

    expect(result).toEqual({
      ...medicineResponse,
      message: "Crocin availability was found nearby.",
    });
    expect(result.toolResult).toBe(medicineResponse.toolResult);
  });

  for (const [label, response] of [
    [
      "clinical refusal",
      {
        status: "refused",
        intent: "clinical_decision",
        message: "Deterministic clinical refusal.",
        suggestedActions: [],
      },
    ],
    [
      "unknown response",
      {
        status: "unsupported",
        intent: "unknown",
        message: "Deterministic unsupported response.",
        suggestedActions: [],
      },
    ],
    [
      "tool error",
      {
        status: "error",
        intent: "medicine_discovery",
        message: "Deterministic error.",
        suggestedActions: [],
        toolResult: {
          status: "error",
          code: "execution_failed",
          message: "Deterministic error.",
        },
      },
    ],
  ] as const) {
    it(`never calls the provider for ${label}`, async () => {
      const ai = provider(() =>
        Promise.resolve({ status: "success", data: "should not run" }),
      );
      const assistant = new OperationalReplyEnhancer(responder(response), ai);

      const result = await assistant.respond(request, context);

      expect(ai.generateOperationalReply).not.toHaveBeenCalled();
      expect(result).toBe(response);
    });
  }

  for (const intent of [
    "pharmacy_discovery",
    "order_status",
    "prescription_workflow",
    "prescription_status",
    "delivery_tracking",
    "support_request",
  ] as const) {
    it(`does not expose fulfilled ${intent} responses to the provider`, async () => {
      const response: AssistantResponse = {
        status: "fulfilled",
        intent,
        message:
          "Sensitive deterministic text: order MC-100; recorded reason: private pharmacist note.",
        suggestedActions: [],
        toolResult: {
          status: "success",
          data: {
            reviewNotes: "private review note",
            rejectionReason: "private rejection reason",
            exactAddress: "private exact address",
          },
        },
      };
      const ai = provider(() =>
        Promise.resolve({ status: "success", data: "should not run" }),
      );
      const assistant = new OperationalReplyEnhancer(responder(response), ai);

      const result = await assistant.respond(request, context);

      expect(ai.generateOperationalReply).not.toHaveBeenCalled();
      expect(result).toBe(response);
    });
  }

  it("returns the exact deterministic response when no provider is configured", async () => {
    const response = structuredClone(medicineResponse);
    const assistant = new OperationalReplyEnhancer(responder(response));

    const result = await assistant.respond(request, context);

    expect(result).toBe(response);
  });

  for (const [label, providerResult] of [
    [
      "provider error result",
      {
        status: "error",
        code: "execution_failed",
        message: "provider failure",
      },
    ],
    ["empty provider output", { status: "success", data: "   " }],
    ["oversized provider output", { status: "success", data: "x".repeat(2001) }],
  ] as const) {
    it(`falls back exactly for ${label}`, async () => {
      const response = structuredClone(medicineResponse);
      const ai = provider(() => Promise.resolve(providerResult));
      const assistant = new OperationalReplyEnhancer(responder(response), ai);

      const result = await assistant.respond(request, context);

      expect(result).toBe(response);
    });
  }

  it("falls back exactly when the provider throws", async () => {
    const response = structuredClone(medicineResponse);
    const ai = provider(() => Promise.reject(new Error("private provider error")));
    const assistant = new OperationalReplyEnhancer(responder(response), ai);

    const result = await assistant.respond(request, context);

    expect(result).toBe(response);
  });
});