import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createTrustedAssistantContext,
  SupportService,
  SupportServiceAdapter,
  UnavailableOrderOwnershipChecker,
  UnavailableSupportRepository,
  type CreateOwnedMessageRecordInput,
  type CreateTicketRecordInput,
  type OrderOwnershipChecker,
  type SupportMessageRecord,
  type SupportRepository,
  type SupportResult,
  type SupportTicketRecord,
} from "../src/modules/intelligence-experience/index.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const TICKET_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_TICKET_ID = "55555555-5555-4555-8555-555555555555";
const context = createTrustedAssistantContext({ userId: CUSTOMER_ID, roles: ["CUSTOMER"] }, "support-request");

class TestSupportRepository implements SupportRepository {
  readonly tickets = new Map<string, SupportTicketRecord>();
  lastCreate?: CreateTicketRecordInput;
  lastMessage?: CreateOwnedMessageRecordInput;
  createCalls = 0;

  constructor() {
    this.tickets.set(TICKET_ID, ticket(TICKET_ID, CUSTOMER_ID));
    this.tickets.set(OTHER_TICKET_ID, ticket(OTHER_TICKET_ID, OTHER_CUSTOMER_ID));
  }

  async createTicket(input: CreateTicketRecordInput): Promise<SupportResult<SupportTicketRecord>> {
    this.createCalls += 1;
    this.lastCreate = input;
    const created = ticket("66666666-6666-4666-8666-666666666666", input.reporterId, input);
    this.tickets.set(created.id, created);
    return { status: "success", data: created };
  }

  async listTicketsByReporter(reporterId: string): Promise<SupportResult<readonly SupportTicketRecord[]>> {
    return { status: "success", data: [...this.tickets.values()].filter((item) => item.reporterId === reporterId) };
  }

  async findTicketByIdAndReporter(
    ticketId: string,
    reporterId: string,
    _includeMessages: boolean,
  ): Promise<SupportResult<SupportTicketRecord>> {
    const found = this.tickets.get(ticketId);
    return found?.reporterId === reporterId
      ? { status: "success", data: found }
      : { status: "error", code: "not_found", message: "Support ticket was not found." };
  }

  async createMessageForOwnedTicket(input: CreateOwnedMessageRecordInput): Promise<SupportResult<SupportMessageRecord>> {
    this.lastMessage = input;
    const owned = this.tickets.get(input.ticketId)?.reporterId === input.reporterId;
    if (!owned) return { status: "error", code: "not_found", message: "Support ticket was not found." };
    return {
      status: "success",
      data: {
        id: "77777777-7777-4777-8777-777777777777",
        ticketId: input.ticketId,
        senderId: input.senderId,
        message: input.message,
        createdAt: new Date("2026-09-11T00:00:00.000Z"),
      },
    };
  }
}

class TestOrderOwnershipChecker implements OrderOwnershipChecker {
  constructor(readonly result: SupportResult<{ readonly owned: true }> = { status: "success", data: { owned: true } }) {}

  async verifyOwnership(_orderId: string, _customerId: string): Promise<SupportResult<{ readonly owned: true }>> {
    return this.result;
  }
}

function service(
  repository: SupportRepository = new TestSupportRepository(),
  ownership: OrderOwnershipChecker = new TestOrderOwnershipChecker(),
): SupportService {
  return new SupportService(repository, ownership);
}

function validCreate(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return { subject: "Late delivery", description: "My delivery has not arrived.", category: "DELAYED_DELIVERY", ...overrides };
}

function ticket(id: string, reporterId: string, input?: Partial<CreateTicketRecordInput>): SupportTicketRecord {
  return {
    id,
    reporterId,
    orderId: input?.orderId,
    subject: input?.subject ?? "Existing issue",
    description: input?.description ?? "Existing issue description",
    category: input?.category ?? "OTHER",
    status: "OPEN",
    createdAt: new Date("2026-09-11T00:00:00.000Z"),
    updatedAt: new Date("2026-09-11T00:00:00.000Z"),
  };
}

test("authenticated customer creates a support ticket", async () => {
  const result = await service().createTicket(validCreate(), context);
  assert.equal(result.status, "success");
});

test("trusted customer becomes the ticket reporter", async () => {
  const repository = new TestSupportRepository();
  await service(repository).createTicket(validCreate(), context);
  assert.equal(repository.lastCreate?.reporterId, CUSTOMER_ID);
});

test("spoofed identity and lifecycle fields are rejected", async () => {
  const repository = new TestSupportRepository();
  const result = await service(repository).createTicket(validCreate({ userId: OTHER_CUSTOMER_ID, assignedAdminId: OTHER_CUSTOMER_ID }), context);
  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "invalid_request");
  assert.equal(repository.createCalls, 0);
});

test("invalid category is rejected", async () => {
  const result = await service().createTicket(validCreate({ category: "MADE_UP" }), context);
  assert.equal(result.status, "error");
});

test("empty subject is rejected", async () => {
  const result = await service().createTicket(validCreate({ subject: "  " }), context);
  assert.equal(result.status, "error");
});

test("empty description is rejected", async () => {
  const result = await service().createTicket(validCreate({ description: "  " }), context);
  assert.equal(result.status, "error");
});

test("subject length is validated", async () => {
  assert.equal((await service().createTicket(validCreate({ subject: "ab" }), context)).status, "error");
  assert.equal((await service().createTicket(validCreate({ subject: "x".repeat(121) }), context)).status, "error");
});

test("description length is validated", async () => {
  const result = await service().createTicket(validCreate({ description: "x".repeat(2001) }), context);
  assert.equal(result.status, "error");
});

test("owned order is accepted", async () => {
  const repository = new TestSupportRepository();
  const result = await service(repository).createTicket(validCreate({ orderId: ORDER_ID }), context);
  assert.equal(result.status, "success");
  assert.equal(repository.lastCreate?.orderId, ORDER_ID);
});

test("missing or non-owned order returns ownership-safe not_found", async () => {
  const ownership = new TestOrderOwnershipChecker({ status: "error", code: "not_found", message: "Order was not found." });
  const repository = new TestSupportRepository();
  const result = await service(repository, ownership).createTicket(validCreate({ orderId: ORDER_ID }), context);
  assert.deepEqual(result, { status: "error", code: "not_found", message: "Order was not found." });
  assert.equal(repository.createCalls, 0);
});

test("unavailable order ownership dependency is propagated", async () => {
  const result = await service(new TestSupportRepository(), new UnavailableOrderOwnershipChecker())
    .createTicket(validCreate({ orderId: ORDER_ID }), context);
  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "unavailable");
});

test("list returns only the trusted customer's tickets", async () => {
  const result = await service().listOwnTickets(context);
  assert.equal(result.status, "success");
  if (result.status === "success") assert.deepEqual(result.data.map((item) => item.id), [TICKET_ID]);
});

test("own ticket retrieval succeeds without internal reporter identity", async () => {
  const result = await service().getOwnTicket(TICKET_ID, context);
  assert.equal(result.status, "success");
  if (result.status === "success") assert.equal("reporterId" in result.data, false);
});

test("another customer's ticket is ownership-safe not_found", async () => {
  const result = await service().getOwnTicket(OTHER_TICKET_ID, context);
  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "not_found");
});

test("valid message to own ticket succeeds with trusted sender identity", async () => {
  const repository = new TestSupportRepository();
  const result = await service(repository).addMessage({ ticketId: TICKET_ID, message: "Please share an update." }, context);
  assert.equal(result.status, "success");
  assert.equal(repository.lastMessage?.senderId, CUSTOMER_ID);
  if (result.status === "success") assert.equal("senderId" in result.data, false);
});

test("customer-supplied sender identity is rejected", async () => {
  const repository = new TestSupportRepository();
  const result = await service(repository).addMessage(
    { ticketId: TICKET_ID, message: "Please share an update.", senderId: OTHER_CUSTOMER_ID },
    context,
  );
  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "invalid_request");
  assert.equal(repository.lastMessage, undefined);
});

test("empty support message is rejected", async () => {
  const result = await service().addMessage({ ticketId: TICKET_ID, message: " " }, context);
  assert.equal(result.status, "error");
});

test("malformed ticket ID is rejected", async () => {
  const result = await service().addMessage({ ticketId: "not-a-uuid", message: "Update please" }, context);
  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "invalid_request");
});

test("another customer's ticket cannot be messaged", async () => {
  const repository = new TestSupportRepository();
  const result = await service(repository).addMessage({ ticketId: OTHER_TICKET_ID, message: "Unauthorized" }, context);
  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "not_found");
  assert.equal(repository.lastMessage, undefined);
});

test("unavailable repository never fabricates support data", async () => {
  const unavailableService = service(new UnavailableSupportRepository());
  const create = await unavailableService.createTicket(validCreate(), context);
  const list = await unavailableService.listOwnTickets(context);
  assert.equal(create.status, "error");
  assert.equal(list.status, "error");
  if (create.status === "error") assert.equal(create.code, "unavailable");
  if (list.status === "error") assert.equal(list.code, "unavailable");
});

test("SupportAdapter delegates to SupportService with trusted context", async () => {
  const repository = new TestSupportRepository();
  const adapter = new SupportServiceAdapter(service(repository));
  const result = await adapter.createSupportRequest(
    { category: "delayed delivery", details: "My delivery has not arrived." },
    context,
  );
  assert.equal(result.status, "success");
  assert.equal(repository.lastCreate?.reporterId, CUSTOMER_ID);
  assert.equal(repository.lastCreate?.category, "DELAYED_DELIVERY");
});
