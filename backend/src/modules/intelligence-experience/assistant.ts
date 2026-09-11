import { isDeliveryTrackingData } from "./adapters/delivery-tracking.adapter.js";
import type {
  AssistantIntent,
  DeliveryTrackingData,
  MedicineDiscoveryData,
  OrderStatusData,
  PrescriptionStatusData,
  AssistantRequest,
  AssistantResponse,
  TrustedAssistantContext,
} from "./contracts.js";
import { routeAssistantRequest } from "./routing.js";
import { evaluateAssistantSafety } from "./safety-policy.js";
import { ToolRegistry } from "./tool-registry.js";

export class DeterministicAssistant {
  readonly #tools: ToolRegistry;

  constructor(tools: ToolRegistry) {
    this.#tools = tools;
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

    if (route.intent === "support_request" && "clarificationRequired" in route) {
      const result = {
        status: "error" as const,
        code: "invalid_request" as const,
        message: "Please specify whether the issue is about a delayed delivery, wrong order, missing item, payment, rider, pharmacy, or prescription.",
      };
      return { status: "error", intent: route.intent, message: result.message, suggestedActions: [], toolResult: result };
    }

    if (!("toolName" in route)) {
      return {
        status: "unsupported",
        intent: route.intent,
        message: "I can help you find a named medicine or pharmacy, explain prescription upload, check an order or prescription using its ID, track a delivery, or start a support request. I can't provide medical diagnosis, prescribing, or dosage advice.",
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
      message: successMessage(route.intent, result.data),
      suggestedActions: [],
      toolResult: result,
    };
  }
}

function successMessage(intent: AssistantIntent, data: unknown): string {
  if (intent === "delivery_tracking" && isDeliveryTrackingData(data)) return deliverySummary(data);
  if (intent === "medicine_discovery" && isMedicineDiscoveryData(data)) {
    const count = data.pharmacies.length;
    const pharmacyLabel = count === 1 ? "pharmacy" : "pharmacies";
    const availability = count > 0
      ? `${data.medicine.name} is reported available at ${count} ${pharmacyLabel} within ${data.radiusKm} km.`
      : `${data.medicine.name} was found, but no eligible pharmacy within ${data.radiusKm} km currently reports it as available.`;
    const stale = data.pharmacies.some(({ inventory }) => inventory.freshness === "STALE")
      ? " Some availability information was last updated more than 24 hours ago and may have changed."
      : "";
    const prescription = data.medicine.requiresPrescription
      ? " This medicine is marked as requiring a prescription."
      : "";
    return `${availability}${stale}${prescription}`;
  }
  if (intent === "order_status" && isOrderStatusData(data)) {
    const { orderNumber, status } = data.order;
    if (status === "DELIVERED") return `Order ${orderNumber} was delivered.`;
    if (status === "PRESCRIPTION_PENDING") return `Order ${orderNumber} is awaiting prescription review.`;
    if (status === "CONFIRMED") return `Order ${orderNumber} has been confirmed.`;
    return `Order ${orderNumber} is currently ${status}.`;
  }
  if (intent === "prescription_status" && isPrescriptionStatusData(data)) {
    const { status, rejectionReason } = data.prescription;
    if (status === "PENDING_REVIEW") return "Your prescription is pending pharmacy review.";
    if (status === "APPROVED") return "Your prescription was approved through the pharmacy review process.";
    if (status === "ADDITIONAL_INFO_REQUIRED") return "The pharmacy requested additional prescription information.";
    const reason = rejectionReason?.trim();
    return `Your prescription was rejected through the pharmacy review process.${reason ? ` Recorded reason: ${reason}` : ""}`;
  }
  const messages: Partial<Record<AssistantIntent, string>> = {
    medicine_discovery: "Medicine availability information was retrieved.",
    pharmacy_discovery: "Pharmacy availability information was retrieved.",
    order_status: "Your order information was retrieved.",
    prescription_status: "Your prescription review information was retrieved.",
    delivery_tracking: "Delivery tracking information was retrieved.",
    support_request: "Your support request was submitted.",
  };
  return messages[intent] ?? "The MediConnect request was completed.";
}

function isOrderStatusData(data: unknown): data is OrderStatusData {
  if (!isRecord(data)) return false;
  if (!isRecord(data.order) || !Array.isArray(data.items) || !Array.isArray(data.prescriptions)) return false;
  return typeof data.order.orderNumber === "string" && typeof data.order.status === "string";
}

function isPrescriptionStatusData(data: unknown): data is PrescriptionStatusData {
  return isRecord(data) && isRecord(data.prescription) && typeof data.prescription.status === "string";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isMedicineDiscoveryData(data: unknown): data is MedicineDiscoveryData {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as Record<string, unknown>;
  if (typeof candidate.radiusKm !== "number" || !Array.isArray(candidate.pharmacies)) return false;
  if (typeof candidate.medicine !== "object" || candidate.medicine === null) return false;
  const medicine = candidate.medicine as Record<string, unknown>;
  return typeof medicine.name === "string" && typeof medicine.requiresPrescription === "boolean";
}

function deliverySummary(data: DeliveryTrackingData): string {
  const { orderNumber, status } = data.order;
  const { assignmentStatus, quotedEtaMinutes } = data.delivery;
  if (status === "DELIVERED") return `Order ${orderNumber} has been delivered.`;
  if (status === "CANCELLED") return `Order ${orderNumber} has been cancelled.`;
  if (status === "REJECTED_BY_PHARMACY") return `Order ${orderNumber} was rejected by the pharmacy.`;
  if (assignmentStatus === "FAILED") return `A delivery attempt for order ${orderNumber} failed.`;
  if (assignmentStatus === "DELIVERED") return `Order ${orderNumber} has been delivered.`;
  let summary: string;
  if (assignmentStatus === "OUT_FOR_DELIVERY" || status === "OUT_FOR_DELIVERY") summary = `Order ${orderNumber} is out for delivery.`;
  else if (assignmentStatus === "PICKED_UP" || status === "PICKED_UP") summary = `Order ${orderNumber} has been picked up from the pharmacy.`;
  else if (assignmentStatus === "ACCEPTED" || status === "RIDER_ASSIGNED") summary = `A rider has been assigned to order ${orderNumber}.`;
  else if (status === "PREPARING") summary = `Order ${orderNumber} is being prepared.`;
  else if (status === "READY_FOR_PICKUP") summary = `Order ${orderNumber} is ready for pickup by a rider.`;
  else return `Order ${orderNumber} is currently ${status}.`;
  return summary + (quotedEtaMinutes === null ? "" : ` The quoted delivery ETA was ${quotedEtaMinutes} minutes.`);
}
