import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { UserRole } from "../generated/prisma/client.js";
import { createApp } from "../src/app.js";
import { DeterministicAssistant } from "../src/modules/intelligence-experience/assistant.js";
import type {
  AssistantRequest,
  AssistantResponse,
  TrustedAssistantContext,
} from "../src/modules/intelligence-experience/contracts.js";
import { ToolRegistry } from "../src/modules/intelligence-experience/tool-registry.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
};

const customerId = "11111111-1111-4111-8111-111111111111";

function authToken(role: UserRole = UserRole.CUSTOMER) {
  return signAuthToken({ userId: customerId, role });
}

function authenticateAs(role: UserRole = UserRole.CUSTOMER) {
  prismaMock.user.findUnique.mockResolvedValueOnce({
    id: customerId,
    role,
    isActive: true,
  });

  return `Bearer ${authToken(role)}`;
}

describe("assistant API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests before invoking the assistant", async () => {
    const assistant = new DeterministicAssistant(new ToolRegistry());
    const respond = vi.spyOn(assistant, "respond");
    const app = createApp({ assistant });

    const response = await request(app)
      .post("/api/v1/assistant/respond")
      .send({ message: "Track my order", channel: "text" });

    expect(response.status).toBe(401);
    expect(respond).not.toHaveBeenCalled();
  });

  it("rejects authenticated non-customer roles before invoking the assistant", async () => {
    const assistant = new DeterministicAssistant(new ToolRegistry());
    const respond = vi.spyOn(assistant, "respond");
    const app = createApp({ assistant });

    const response = await request(app)
      .post("/api/v1/assistant/respond")
      .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF))
      .send({ message: "Track my order", channel: "text" });

    expect(response.status).toBe(403);
    expect(respond).not.toHaveBeenCalled();
  });

  it("constructs trusted context only from the authenticated server principal", async () => {
    const assistant = new DeterministicAssistant(new ToolRegistry());

    let capturedRequest: AssistantRequest | undefined;
    let capturedContext: TrustedAssistantContext | undefined;

    const deterministicResponse: AssistantResponse = {
      status: "unsupported",
      intent: "unknown",
      message: "Deterministic response.",
      suggestedActions: [],
    };

    vi.spyOn(assistant, "respond").mockImplementation(async (assistantRequest, context) => {
      capturedRequest = assistantRequest;
      capturedContext = context;
      return deterministicResponse;
    });

    const app = createApp({ assistant });

    const response = await request(app)
      .post("/api/v1/assistant/respond")
      .set("Authorization", authenticateAs(UserRole.CUSTOMER))
      .set("x-request-id", "attacker-request-id")
      .send({
        message: "Track my order",
        channel: "text",
        correlationId: "client-correlation-id",
        userId: "attacker-user-id",
        roles: ["ADMIN"],
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(deterministicResponse);

    expect(capturedRequest).toEqual({
      message: "Track my order",
      channel: "text",
      correlationId: "client-correlation-id",
    });

    expect(capturedContext).toBeDefined();
    expect(capturedContext?.userId).toBe(customerId);
    expect(capturedContext?.roles).toEqual([UserRole.CUSTOMER]);
    expect(capturedContext?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(capturedContext?.requestId).not.toBe("attacker-request-id");
    expect(capturedContext?.requestId).not.toBe("client-correlation-id");
  });
  it("rejects invalid assistant request bodies before invoking the assistant", async () => {
    const invalidBodies = [
      {},
      { message: "", channel: "text" },
      { message: "   ", channel: "text" },
      { message: "Track my order", channel: "email" },
      { message: "x".repeat(2001), channel: "text" },
      { message: "Track my order", channel: "text", correlationId: "" },
      { message: "Track my order", channel: "text", correlationId: 123 },
      {
        message: "Track my order",
        channel: "text",
        correlationId: "x".repeat(201),
      },
    ];

    for (const body of invalidBodies) {
      const assistant = new DeterministicAssistant(new ToolRegistry());
      const respond = vi.spyOn(assistant, "respond");
      const app = createApp({ assistant });

      const response = await request(app)
        .post("/api/v1/assistant/respond")
        .set("Authorization", authenticateAs(UserRole.CUSTOMER))
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "Invalid assistant request.",
        code: "INVALID_REQUEST",
      });
      expect(respond).not.toHaveBeenCalled();
    }
  });

  it("preserves deterministic clinical refusal through the HTTP route", async () => {
    const tools = new ToolRegistry();
    const execute = vi.spyOn(tools, "execute");
    const assistant = new DeterministicAssistant(tools);
    const app = createApp({ assistant });

    const response = await request(app)
      .post("/api/v1/assistant/respond")
      .set("Authorization", authenticateAs(UserRole.CUSTOMER))
      .send({
        message: "What dosage should I take?",
        channel: "text",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "refused",
      intent: "clinical_decision",
      message:
        "The MediConnect assistant can help with platform and customer-service tasks, but it cannot make medical decisions, recommend medicines or dosage, or assess a prescription clinically. Please ask an appropriate doctor or pharmacist for medical guidance.",
      suggestedActions: [
        {
          id: "contact-healthcare-professional",
          label: "Contact a doctor or pharmacist",
          kind: "contact_professional",
        },
      ],
    });
    expect(execute).not.toHaveBeenCalled();
  });
});