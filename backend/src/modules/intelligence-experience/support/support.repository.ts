import { supportError, type SupportResult, type SupportTicketCategory, type SupportTicketRecord, type SupportMessageRecord } from "./support.types.js";

export interface CreateTicketRecordInput {
  readonly reporterId: string;
  readonly orderId?: string;
  readonly subject: string;
  readonly description: string;
  readonly category: SupportTicketCategory;
}

export interface CreateOwnedMessageRecordInput {
  readonly ticketId: string;
  readonly reporterId: string;
  readonly senderId: string;
  readonly message: string;
}

export interface SupportRepository {
  createTicket(input: CreateTicketRecordInput): Promise<SupportResult<SupportTicketRecord>>;
  listTicketsByReporter(reporterId: string): Promise<SupportResult<readonly SupportTicketRecord[]>>;
  findTicketByIdAndReporter(
    ticketId: string,
    reporterId: string,
    includeMessages: boolean,
  ): Promise<SupportResult<SupportTicketRecord>>;
  createMessageForOwnedTicket(input: CreateOwnedMessageRecordInput): Promise<SupportResult<SupportMessageRecord>>;
}

export class UnavailableSupportRepository implements SupportRepository {
  async createTicket(_input: CreateTicketRecordInput): Promise<SupportResult<SupportTicketRecord>> {
    return unavailable();
  }

  async listTicketsByReporter(_reporterId: string): Promise<SupportResult<readonly SupportTicketRecord[]>> {
    return unavailable();
  }

  async findTicketByIdAndReporter(
    _ticketId: string,
    _reporterId: string,
    _includeMessages: boolean,
  ): Promise<SupportResult<SupportTicketRecord>> {
    return unavailable();
  }

  async createMessageForOwnedTicket(
    _input: CreateOwnedMessageRecordInput,
  ): Promise<SupportResult<SupportMessageRecord>> {
    return unavailable();
  }
}

function unavailable(): SupportResult<never> {
  return supportError("unavailable", "Support persistence is currently unavailable.");
}

export interface OrderOwnershipChecker {
  verifyOwnership(orderId: string, customerId: string): Promise<SupportResult<{ readonly owned: true }>>;
}

export class UnavailableOrderOwnershipChecker implements OrderOwnershipChecker {
  async verifyOwnership(_orderId: string, _customerId: string): Promise<SupportResult<{ readonly owned: true }>> {
    return supportError("unavailable", "Order ownership verification is currently unavailable.");
  }
}
