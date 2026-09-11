import type {
  DeliveryTrackingToolInput,
  DeliveryTrackingAdapter,
  MedicineDiscoveryAdapter,
  MedicineDiscoveryToolInput,
  OrderContextAdapter,
  OrderContextToolInput,
  PrescriptionContextAdapter,
  PrescriptionContextToolInput,
  SupportAdapter,
  SupportToolInput,
  ToolExecutionResult,
} from "./contracts.js";
import { DeterministicAssistant } from "./assistant.js";
import { ToolRegistry } from "./tool-registry.js";

export interface IntelligenceDependencies {
  readonly medicineDiscovery: MedicineDiscoveryAdapter;
  readonly orderContext: OrderContextAdapter;
  readonly prescriptionContext: PrescriptionContextAdapter;
  readonly deliveryTracking: DeliveryTrackingAdapter;
  readonly support: SupportAdapter;
}

function unavailable(name: string): ToolExecutionResult<never> {
  return { status: "error", code: "unavailable", message: `${name} is currently unavailable.` };
}

/** Production-safe defaults fail explicitly; they never manufacture domain data. */
export function createUnavailableIntelligenceDependencies(): IntelligenceDependencies {
  return {
    medicineDiscovery: { discover: async () => unavailable("Medicine discovery") },
    orderContext: { getOrder: async () => unavailable("Order information") },
    prescriptionContext: { getPrescriptionStatus: async () => unavailable("Prescription information") },
    deliveryTracking: { getTracking: async () => unavailable("Delivery tracking") },
    support: { createSupportRequest: async () => unavailable("Customer support") },
  };
}

export function composeIntelligenceModule(dependencies: IntelligenceDependencies): DeterministicAssistant {
  const registry = new ToolRegistry();
  registry.register({
    name: "medicine.discovery",
    description: "Read medicine and pharmacy discovery data from Pharmacy Network.",
    execute: async (input, context) => {
      if (!isMedicineDiscoveryInput(input)) return invalidRequest("Medicine discovery input is invalid.");
      return dependencies.medicineDiscovery.discover(input, context);
    },
  });
  registry.register({
    name: "order.context",
    description: "Read an authenticated customer's order context from Commerce.",
    execute: async (input, context) => {
      if (!isOrderContextInput(input) || !hasIdentifier(input.orderId)) {
        return invalidRequest("Please provide the order ID to check its status.");
      }
      return dependencies.orderContext.getOrder(input.orderId, context);
    },
  });
  registry.register({
    name: "prescription.context",
    description: "Read human prescription review status from Commerce.",
    execute: async (input, context) => {
      if (!isPrescriptionContextInput(input) || !hasIdentifier(input.prescriptionId)) {
        return invalidRequest("Please provide the prescription ID to check its review status.");
      }
      return dependencies.prescriptionContext.getPrescriptionStatus(input.prescriptionId, context);
    },
  });
  registry.register({
    name: "delivery.tracking",
    description: "Read structured delivery data from Delivery & Logistics.",
    execute: async (input, context) => {
      if (!isDeliveryTrackingInput(input) || !hasIdentifier(input.orderId)) {
        return invalidRequest("Please provide the order ID to track the delivery.");
      }
      return dependencies.deliveryTracking.getTracking(input.orderId, context);
    },
  });
  registry.register({
    name: "support.create",
    description: "Pass a validated customer support request to the Support domain boundary.",
    execute: async (input, context) => {
      if (
        !isSupportInput(input)
        || !hasIdentifier(input.category)
        || !hasIdentifier(input.details)
        || (input.orderId !== undefined && !hasIdentifier(input.orderId))
      ) {
        return invalidRequest("Support category and details are required.");
      }
      return dependencies.support.createSupportRequest(
        { orderId: input.orderId, category: input.category, details: input.details },
        context,
      );
    },
  });

  return new DeterministicAssistant(registry);
}

function invalidRequest(message: string): ToolExecutionResult<never> {
  return { status: "error", code: "invalid_request", message };
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null;
}

function isMedicineDiscoveryInput(input: unknown): input is MedicineDiscoveryToolInput {
  if (!isRecord(input)) return false;
  return (input.medicineName === undefined || typeof input.medicineName === "string")
    && (input.latitude === undefined || typeof input.latitude === "number")
    && (input.longitude === undefined || typeof input.longitude === "number")
    && (input.radiusKm === undefined || typeof input.radiusKm === "number");
}

function isOrderContextInput(input: unknown): input is OrderContextToolInput {
  return isRecord(input) && (input.orderId === undefined || typeof input.orderId === "string");
}

function isPrescriptionContextInput(input: unknown): input is PrescriptionContextToolInput {
  return isRecord(input) && (input.prescriptionId === undefined || typeof input.prescriptionId === "string");
}

function isDeliveryTrackingInput(input: unknown): input is DeliveryTrackingToolInput {
  return isRecord(input) && (input.orderId === undefined || typeof input.orderId === "string");
}

function isSupportInput(input: unknown): input is SupportToolInput {
  return isRecord(input)
    && (input.orderId === undefined || typeof input.orderId === "string")
    && (input.category === undefined || typeof input.category === "string")
    && (input.details === undefined || typeof input.details === "string");
}

function hasIdentifier(identifier: string | undefined): identifier is string {
  return typeof identifier === "string" && identifier.trim().length > 0;
}
