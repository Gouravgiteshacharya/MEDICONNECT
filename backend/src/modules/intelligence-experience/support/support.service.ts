import type { TrustedAssistantContext } from "../contracts.js";
import type { OrderOwnershipChecker, SupportRepository } from "./support.repository.js";
import {
  supportError,
  type CustomerSupportMessageDto,
  type CustomerSupportTicketDto,
  type SupportMessageRecord,
  type SupportResult,
  type SupportServiceContract,
  type SupportTicketRecord,
} from "./support.types.js";
import { validateAddMessageInput, validateCreateTicketInput, validateTicketId } from "./support.validation.js";

export class SupportService implements SupportServiceContract {
  readonly #repository: SupportRepository;
  readonly #orderOwnership: OrderOwnershipChecker;

  constructor(repository: SupportRepository, orderOwnership: OrderOwnershipChecker) {
    this.#repository = repository;
    this.#orderOwnership = orderOwnership;
  }

  async createTicket(input: unknown, context: TrustedAssistantContext): Promise<SupportResult<CustomerSupportTicketDto>> {
    const validated = validateCreateTicketInput(input);
    if (validated.status === "error") return validated;

    const orderId = validated.data.orderId;
    if (orderId) {
      const ownership = await safely(() => this.#orderOwnership.verifyOwnership(orderId, context.userId));
      if (ownership.status === "error") return ownership;
    }

    const created = await safely(() => this.#repository.createTicket({
      reporterId: context.userId,
      orderId,
      subject: validated.data.subject,
      description: validated.data.description,
      category: validated.data.category,
    }));
    return created.status === "success"
      ? { status: "success", data: toCustomerTicket(created.data, context.userId) }
      : created;
  }

  async listOwnTickets(context: TrustedAssistantContext): Promise<SupportResult<readonly CustomerSupportTicketDto[]>> {
    const result = await safely(() => this.#repository.listTicketsByReporter(context.userId));
    return result.status === "success"
      ? { status: "success", data: result.data.map((ticket) => toCustomerTicket(ticket, context.userId)) }
      : result;
  }

  async getOwnTicket(ticketId: unknown, context: TrustedAssistantContext): Promise<SupportResult<CustomerSupportTicketDto>> {
    const validated = validateTicketId(ticketId);
    if (validated.status === "error") return validated;
    const result = await safely(() => this.#repository.findTicketByIdAndReporter(validated.data, context.userId, true));
    return result.status === "success"
      ? { status: "success", data: toCustomerTicket(result.data, context.userId) }
      : result;
  }

  async addMessage(input: unknown, context: TrustedAssistantContext): Promise<SupportResult<CustomerSupportMessageDto>> {
    const validated = validateAddMessageInput(input);
    if (validated.status === "error") return validated;

    const ownedTicket = await safely(() => this.#repository.findTicketByIdAndReporter(
      validated.data.ticketId,
      context.userId,
      false,
    ));
    if (ownedTicket.status === "error") return ownedTicket;

    const created = await safely(() => this.#repository.createMessageForOwnedTicket({
      ticketId: validated.data.ticketId,
      reporterId: context.userId,
      senderId: context.userId,
      message: validated.data.message,
    }));
    return created.status === "success"
      ? { status: "success", data: toCustomerMessage(created.data, context.userId) }
      : created;
  }
}

function toCustomerTicket(record: SupportTicketRecord, customerId: string): CustomerSupportTicketDto {
  return {
    id: record.id,
    orderId: record.orderId,
    subject: record.subject,
    description: record.description,
    category: record.category,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    resolvedAt: record.resolvedAt,
    ...(record.messages
      ? { messages: record.messages.map((message) => toCustomerMessage(message, customerId)) }
      : {}),
  };
}

function toCustomerMessage(record: SupportMessageRecord, customerId: string): CustomerSupportMessageDto {
  return {
    id: record.id,
    ticketId: record.ticketId,
    message: record.message,
    createdAt: record.createdAt,
    isOwnMessage: record.senderId === customerId,
  };
}

async function safely<T>(operation: () => Promise<SupportResult<T>>): Promise<SupportResult<T>> {
  try {
    return await operation();
  } catch {
    return supportError("execution_failed", "The support operation could not be completed.");
  }
}
