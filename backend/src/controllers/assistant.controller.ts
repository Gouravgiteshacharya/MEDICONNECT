import { randomUUID } from "node:crypto";

import type { Request, Response } from "express";

import type { AssistantResponder } from "../modules/intelligence-experience/contracts.js";
import {
  createTrustedAssistantContext,
  type AssistantChannel,
  type AssistantRequest,
} from "../modules/intelligence-experience/contracts.js";
import { ApiError } from "../utils/ApiError.js";

const MAX_ASSISTANT_MESSAGE_LENGTH = 2000;
const MAX_CORRELATION_ID_LENGTH = 200;
const allowedChannels = new Set<AssistantChannel>(["text", "voice"]);

export function createAssistantRespondController(
  assistant: AssistantResponder,
) {
  return async function assistantRespond(req: Request, res: Response) {
    if (!req.user) {
      throw new ApiError(401, "Authentication required.", "AUTH_REQUIRED");
    }

    const request = parseAssistantRequest(req.body);
    const requestId = randomUUID();

    const context = createTrustedAssistantContext(
      {
        userId: req.user.id,
        roles: [req.user.role],
      },
      requestId,
    );

    const response = await assistant.respond(request, context);
    res.json(response);
  };
}

function parseAssistantRequest(input: unknown): AssistantRequest {
  if (!isRecord(input)) {
    throw new ApiError(400, "Invalid assistant request.", "INVALID_REQUEST");
  }

  const message = typeof input.message === "string" ? input.message.trim() : "";
  const channel = input.channel;

  if (
    message.length === 0 ||
    message.length > MAX_ASSISTANT_MESSAGE_LENGTH ||
    typeof channel !== "string" ||
    !allowedChannels.has(channel as AssistantChannel)
  ) {
    throw new ApiError(400, "Invalid assistant request.", "INVALID_REQUEST");
  }

  if (
    input.correlationId !== undefined &&
    typeof input.correlationId !== "string"
  ) {
    throw new ApiError(400, "Invalid assistant request.", "INVALID_REQUEST");
  }

  const correlationId =
    typeof input.correlationId === "string" ? input.correlationId.trim() : undefined;

  if (
    correlationId !== undefined &&
    (correlationId.length === 0 ||
      correlationId.length > MAX_CORRELATION_ID_LENGTH)
  ) {
    throw new ApiError(400, "Invalid assistant request.", "INVALID_REQUEST");
  }

  return correlationId
    ? { message, channel: channel as AssistantChannel, correlationId }
    : { message, channel: channel as AssistantChannel };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}