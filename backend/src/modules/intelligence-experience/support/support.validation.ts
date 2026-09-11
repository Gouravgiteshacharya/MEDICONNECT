import {
  SUPPORT_CATEGORIES,
  supportError,
  type AddSupportMessageInput,
  type CreateSupportTicketInput,
  type SupportResult,
  type SupportTicketCategory,
} from "./support.types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREATE_FIELDS = new Set(["subject", "description", "category", "orderId"]);
const MESSAGE_FIELDS = new Set(["ticketId", "message"]);

export function validateCreateTicketInput(input: unknown): SupportResult<CreateSupportTicketInput> {
  if (!isRecord(input) || hasUnknownFields(input, CREATE_FIELDS)) {
    return supportError("invalid_request", "Support ticket input is malformed.");
  }

  const subject = normalizedString(input.subject);
  const description = normalizedString(input.description);
  if (!subject || subject.length < 3 || subject.length > 120) {
    return supportError("invalid_request", "Subject must contain 3 to 120 characters.");
  }
  if (!description || description.length > 2000) {
    return supportError("invalid_request", "Description must contain 1 to 2000 characters.");
  }
  if (!isSupportCategory(input.category)) {
    return supportError("invalid_request", "Support category is invalid.");
  }

  const orderId = optionalNormalizedString(input.orderId);
  if (input.orderId !== undefined && (!orderId || !isUuid(orderId))) {
    return supportError("invalid_request", "Order ID must be a valid UUID.");
  }

  return {
    status: "success",
    data: { subject, description, category: input.category, ...(orderId ? { orderId } : {}) },
  };
}

export function validateAddMessageInput(input: unknown): SupportResult<AddSupportMessageInput> {
  if (!isRecord(input) || hasUnknownFields(input, MESSAGE_FIELDS)) {
    return supportError("invalid_request", "Support message input is malformed.");
  }

  const ticketId = normalizedString(input.ticketId);
  const message = normalizedString(input.message);
  if (!ticketId || !isUuid(ticketId)) {
    return supportError("invalid_request", "Ticket ID must be a valid UUID.");
  }
  if (!message || message.length > 2000) {
    return supportError("invalid_request", "Message must contain 1 to 2000 characters.");
  }

  return { status: "success", data: { ticketId, message } };
}

export function validateTicketId(ticketId: unknown): SupportResult<string> {
  const normalized = normalizedString(ticketId);
  if (!normalized || !isUuid(normalized)) {
    return supportError("invalid_request", "Ticket ID must be a valid UUID.");
  }
  return { status: "success", data: normalized };
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasUnknownFields(input: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(input).some((key) => !allowed.has(key));
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function optionalNormalizedString(value: unknown): string | undefined {
  return value === undefined ? undefined : normalizedString(value);
}

function isSupportCategory(value: unknown): value is SupportTicketCategory {
  return typeof value === "string" && SUPPORT_CATEGORIES.some((category) => category === value);
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
