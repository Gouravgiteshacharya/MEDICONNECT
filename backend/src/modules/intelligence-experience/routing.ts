import type {
  AssistantIntent,
  AssistantRequest,
  DeliveryTrackingToolInput,
  MedicineDiscoveryToolInput,
  OrderContextToolInput,
  PrescriptionContextToolInput,
  SupportToolInput,
} from "./contracts.js";

export type RoutedAssistantAction =
  | { readonly intent: "medicine_discovery" | "pharmacy_discovery"; readonly toolName: "medicine.discovery"; readonly toolInput: MedicineDiscoveryToolInput }
  | { readonly intent: "order_status"; readonly toolName: "order.context"; readonly toolInput: OrderContextToolInput }
  | { readonly intent: "prescription_status"; readonly toolName: "prescription.context"; readonly toolInput: PrescriptionContextToolInput }
  | { readonly intent: "delivery_tracking"; readonly toolName: "delivery.tracking"; readonly toolInput: DeliveryTrackingToolInput }
  | { readonly intent: "support_request"; readonly toolName: "support.create"; readonly toolInput: SupportToolInput }
  | { readonly intent: Exclude<AssistantIntent, "medicine_discovery" | "pharmacy_discovery" | "order_status" | "prescription_status" | "delivery_tracking" | "support_request"> };

export function routeAssistantRequest(request: AssistantRequest): RoutedAssistantAction {
  const message = request.message.trim();
  const normalized = message.toLowerCase();

  if (/\b(?:is|check|tell me if)\b.*\bprescription\b.*\b(?:medically\s+)?(?:safe|correct|appropriate)\b|\bshould\b.*\bprescription\b.*\b(?:approved|rejected)\b|\b(?:can|could|will|would)\s+you\s+(?:approve|reject)\b.*\bprescription\b|\b(?:what|which)\s+(?:medicine|medication|drug|treatment)\s+(?:should|can|could)\s+i\s+(?:take|use)\b|\b(?:find(?:\s+me)?|suggest|recommend|choose)\s+(?:a\s+)?(?:medicine|medication|drug|treatment)\s+for\b|\b(?:find(?:\s+me)?|suggest|recommend|choose)\s+(?:\w+\s+){0,3}(?:pain|ache|symptoms?|problem|condition)\s+(?:medicine|medication|drug|treatment)\b/i.test(normalized)) {
    return { intent: "clinical_decision" };
  }

  if (/\b(?:how\s+(?:many|much)\s+(?:tablets?|pills?|capsules?)|what\s+(?:dosage|dose)|(?:dosage|dose)\s+(?:should|can|could)\s+i\s+(?:take|use)|(?:tablets?|pills?|capsules?)\s+should\s+i\s+take)\b/i.test(normalized)) {
    return { intent: "clinical_decision" };
  }

  if (/\b(how|where)\b.*\bupload\b.*\bprescription\b/i.test(normalized)) {
    return { intent: "prescription_workflow" };
  }

  if (/\b(?:prescription\b.*\b(?:status|review|pending|approved|rejected)|(?:status|review|pending|approved|rejected)\b.*\bprescription)\b/i.test(normalized)) {
    return {
      intent: "prescription_status",
      toolName: "prescription.context",
      toolInput: { prescriptionId: extractExplicitId(message, "prescription") },
    };
  }

  if (/\b(?:order\b.*\b(?:status|state|progress)|(?:status|state|progress)\b.*\border)\b/i.test(normalized)) {
    return {
      intent: "order_status",
      toolName: "order.context",
      toolInput: { orderId: extractExplicitId(message, "order") },
    };
  }

  if (/\b(where|track|status)\b.*\b(order|delivery|rider)\b/i.test(normalized)) {
    return {
      intent: "delivery_tracking",
      toolName: "delivery.tracking",
      toolInput: { orderId: extractExplicitId(message, "order") },
    };
  }

  if (/\b(complaint|support|order is late|hasn't arrived)\b/i.test(normalized)) {
    return {
      intent: "support_request",
      toolName: "support.create",
      toolInput: {
        orderId: extractExplicitId(message, "order"),
        category: extractLabeledCategory(message),
        details: message,
      },
    };
  }

  if (/\b(pharmacy|pharmacies)\b/i.test(normalized)) {
    return { intent: "pharmacy_discovery", toolName: "medicine.discovery", toolInput: {} };
  }

  if (/\b(what|which)\s+(medicine|medication|drug)\b|\b(find|search|locate|available|stock)\b/i.test(normalized)) {
    return {
      intent: "medicine_discovery",
      toolName: "medicine.discovery",
      toolInput: { medicineName: extractMedicineName(message) },
    };
  }

  if (/\b(unsupported)\b/i.test(normalized)) {
    return { intent: "unknown" };
  }

  return { intent: "unknown" };
}

function extractExplicitId(message: string, subject: "order" | "prescription"): string | undefined {
  const match = new RegExp(`\\b${subject}\\s+(?:id|number|#)\\s*[:#-]?\\s*([a-z0-9-]+)\\b`, "i").exec(message);
  return match?.[1];
}

function extractMedicineName(message: string): string | undefined {
  const match = /\b(?:find|search|locate)\s+(.+?)(?:\s+near\s+me|\s+nearby|$)/i.exec(message);
  return match?.[1]?.trim() || undefined;
}

function extractLabeledCategory(message: string): string | undefined {
  const match = /\bcategory\s*:\s*([^.;\r\n]+)/i.exec(message);
  return match?.[1]?.trim() || undefined;
}
