import type { SupportAdapter, ToolExecutionResult, TrustedAssistantContext } from "../contracts.js";
import type { SupportServiceContract, SupportTicketCategory } from "./support.types.js";

const CATEGORY_MAP: Readonly<Record<string, SupportTicketCategory>> = {
  delayed_delivery: "DELAYED_DELIVERY",
  "delayed delivery": "DELAYED_DELIVERY",
  wrong_order: "WRONG_ORDER",
  "wrong order": "WRONG_ORDER",
  missing_item: "MISSING_ITEM",
  "missing item": "MISSING_ITEM",
  payment: "PAYMENT",
  rider: "RIDER",
  pharmacy: "PHARMACY",
  prescription: "PRESCRIPTION",
  other: "OTHER",
};

export class SupportServiceAdapter implements SupportAdapter {
  readonly #service: SupportServiceContract;

  constructor(service: SupportServiceContract) {
    this.#service = service;
  }

  async createSupportRequest(
    input: Readonly<{ orderId?: string; category: string; details: string }>,
    context: TrustedAssistantContext,
  ): Promise<ToolExecutionResult<unknown>> {
    const description = input.details.trim();
    const category = CATEGORY_MAP[input.category.trim().toLowerCase()];
    if (!description || !category) {
      return { status: "error", code: "invalid_request", message: "Support category and details are invalid." };
    }

    return this.#service.createTicket({
      subject: description.slice(0, 120),
      description,
      category,
      ...(input.orderId ? { orderId: input.orderId } : {}),
    }, context);
  }
}
