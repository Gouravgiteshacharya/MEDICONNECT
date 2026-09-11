import type { TrustedAssistantContext } from "../contracts.js";

export const SUPPORT_CATEGORIES = [
  "DELAYED_DELIVERY",
  "WRONG_ORDER",
  "MISSING_ITEM",
  "PAYMENT",
  "RIDER",
  "PHARMACY",
  "PRESCRIPTION",
  "OTHER",
] as const;

export type SupportTicketCategory = (typeof SUPPORT_CATEGORIES)[number];
export type SupportTicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
export type SupportErrorCode =
  | "invalid_request"
  | "not_found"
  | "forbidden"
  | "unavailable"
  | "execution_failed";

export type SupportResult<T> =
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "error"; readonly code: SupportErrorCode; readonly message: string };

export interface CreateSupportTicketInput {
  readonly subject: string;
  readonly description: string;
  readonly category: SupportTicketCategory;
  readonly orderId?: string;
}

export interface AddSupportMessageInput {
  readonly ticketId: string;
  readonly message: string;
}

export interface SupportMessageRecord {
  readonly id: string;
  readonly ticketId: string;
  readonly senderId: string;
  readonly message: string;
  readonly createdAt: Date;
}

export interface SupportTicketRecord {
  readonly id: string;
  readonly reporterId: string;
  readonly orderId?: string;
  readonly subject: string;
  readonly description: string;
  readonly category: SupportTicketCategory;
  readonly status: SupportTicketStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly resolvedAt?: Date;
  readonly messages?: readonly SupportMessageRecord[];
}

export interface CustomerSupportMessageDto {
  readonly id: string;
  readonly ticketId: string;
  readonly message: string;
  readonly createdAt: Date;
  readonly isOwnMessage: boolean;
}

export interface CustomerSupportTicketDto {
  readonly id: string;
  readonly orderId?: string;
  readonly subject: string;
  readonly description: string;
  readonly category: SupportTicketCategory;
  readonly status: SupportTicketStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly resolvedAt?: Date;
  readonly messages?: readonly CustomerSupportMessageDto[];
}

export interface SupportServiceContract {
  createTicket(input: unknown, context: TrustedAssistantContext): Promise<SupportResult<CustomerSupportTicketDto>>;
  listOwnTickets(context: TrustedAssistantContext): Promise<SupportResult<readonly CustomerSupportTicketDto[]>>;
  getOwnTicket(ticketId: unknown, context: TrustedAssistantContext): Promise<SupportResult<CustomerSupportTicketDto>>;
  addMessage(input: unknown, context: TrustedAssistantContext): Promise<SupportResult<CustomerSupportMessageDto>>;
}

export function supportError(code: SupportErrorCode, message: string): SupportResult<never> {
  return { status: "error", code, message };
}
