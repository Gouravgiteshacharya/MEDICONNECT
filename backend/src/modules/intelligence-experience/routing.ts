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
  | { readonly intent: "support_request"; readonly clarificationRequired: true }
  | { readonly intent: Exclude<AssistantIntent, "medicine_discovery" | "pharmacy_discovery" | "order_status" | "prescription_status" | "delivery_tracking" | "support_request"> };

const SUPPORT_CATEGORIES = [
  ["DELAYED_DELIVERY", /\b(?:delayed?\s+delivery|(?:order|delivery)\s+(?:is\s+)?(?:late|delayed)|(?:order|delivery)\s+(?:hasn't|has\s+not|didn't|did\s+not)\s+arrive)\b/i],
  ["WRONG_ORDER", /\b(?:wrong\s+(?:order|items?)|(?:order|items?)\s+(?:is|are|has|have)\s+wrong)\b/i],
  ["MISSING_ITEM", /\b(?:(?:an?\s+|one\s+|some\s+)?items?\s+(?:is|are)\s+missing|missing\s+items?)\b/i],
  ["PAYMENT", /\b(?:payment|charged|refund)\b.*\b(?:issue|problem|failed|wrong|missing)\b|\b(?:issue|problem)\b.*\bpayment\b/i],
  ["RIDER", /\b(?:rider|delivery\s+partner)\b.*\b(?:issue|problem|complaint)\b|\b(?:issue|problem)\b.*\b(?:rider|delivery\s+partner)\b/i],
  ["PHARMACY", /\bpharmac(?:y|ies)\b.*\b(?:issue|problem|complaint)\b|\b(?:issue|problem)\b.*\bpharmac(?:y|ies)\b/i],
  ["PRESCRIPTION", /\bprescription\b.*\b(?:support|issue|problem|workflow)\b|\b(?:support|issue|problem)\b.*\bprescription\b/i],
] as const;

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export function routeAssistantRequest(request: AssistantRequest): RoutedAssistantAction {
  const message = request.message.trim();

  if (isClinicalDecisionRequest(message)) return { intent: "clinical_decision" };
  if (isPrescriptionWorkflowRequest(message)) return { intent: "prescription_workflow" };

  if (isPrescriptionStatusRequest(message)) {
    return { intent: "prescription_status", toolName: "prescription.context", toolInput: { prescriptionId: extractExplicitId(message, "prescription") } };
  }
  if (isDeliveryTrackingRequest(message)) {
    return { intent: "delivery_tracking", toolName: "delivery.tracking", toolInput: { orderId: extractDeliveryOrderId(message) } };
  }
  if (isOrderStatusRequest(message)) {
    return { intent: "order_status", toolName: "order.context", toolInput: { orderId: extractExplicitId(message, "order") } };
  }
  if (isSupportRequest(message)) {
    const category = extractSupportCategory(message);
    if (!category) return { intent: "support_request", clarificationRequired: true };
    return {
      intent: "support_request",
      toolName: "support.create",
      toolInput: { orderId: extractExplicitId(message, "order"), category, details: message },
    };
  }
  if (isPharmacyDiscoveryRequest(message)) {
    return { intent: "pharmacy_discovery", toolName: "medicine.discovery", toolInput: { discoveryType: "pharmacy" } };
  }

  const medicineName = extractMedicineName(message);
  if (isMedicineDiscoveryRequest(message, medicineName)) {
    return { intent: "medicine_discovery", toolName: "medicine.discovery", toolInput: { discoveryType: "medicine", medicineName } };
  }
  return { intent: "unknown" };
}

export function isClinicalDecisionRequest(message: string): boolean {
  return isDiagnosisRequest(message)
    || isPrescribingRequest(message)
    || isSymptomBasedMedicineSelection(message)
    || isDosageRequest(message)
    || isMedicineSafetyJudgment(message)
    || isPrescriptionClinicalJudgment(message);
}

function isDiagnosisRequest(message: string): boolean {
  return /\bdiagnos(?:e|is|ing)\b|\b(?:do|could|might)\s+i\s+have\b/i.test(message);
}

function isPrescribingRequest(message: string): boolean {
  return /\bprescrib(?:e|ing)\b/i.test(message);
}

function isSymptomBasedMedicineSelection(message: string): boolean {
  return /\b(?:what|which)\s+(?:medicine|medication|drug|treatment)\s+(?:should|can|could)\s+i\s+(?:take|use)\b/i.test(message)
    || /\b(?:find(?:\s+me)?|suggest|recommend|choose)\s+(?:a\s+)?(?:medicine|medication|drug|treatment)\s+for\b/i.test(message)
    || /\b(?:find(?:\s+me)?|suggest|recommend|choose)\s+(?:[\w'-]+\s+){1,4}(?:medicine|medication|drug|treatment)\b/i.test(message);
}

function isDosageRequest(message: string): boolean {
  return /\b(?:how\s+(?:many|much)\s+(?:tablets?|pills?|capsules?)|what\s+(?:dosage|dose)|(?:dosage|dose)\s+(?:should|can|could)\s+i\s+(?:take|use)|(?:tablets?|pills?|capsules?)\s+should\s+i\s+take)\b/i.test(message);
}

function isMedicineSafetyJudgment(message: string): boolean {
  return /\b(?:is|are)\b.*\b(?:medicine|medication|drug|treatment)\b.*\b(?:safe|appropriate)\b.*\b(?:for\s+me|for\s+my)\b/i.test(message)
    || /\bis\s+(?!.*\b(?:order|delivery|rider|pharmacy|payment|account|app|service)\b)[a-z0-9][a-z0-9 .-]{1,60}\s+safe\s+for\s+me\b/i.test(message);
}

function isPrescriptionClinicalJudgment(message: string): boolean {
  return /\b(?:is|check|tell\s+me\s+if)\b.*\bprescription\b.*\b(?:medically\s+)?(?:safe|correct|appropriate)\b/i.test(message)
    || /\bshould\b.*\bprescription\b.*\b(?:approved|rejected)\b/i.test(message)
    || /\b(?:can|could|will|would)\s+you\s+(?:approve|reject)\b.*\bprescription\b/i.test(message)
    || /\bshould\s+i\s+take\b.*\bprescription\b/i.test(message);
}

function isPrescriptionWorkflowRequest(message: string): boolean {
  return /\b(?:how|where)\b.*\bupload\b.*\bprescription\b/i.test(message);
}

function isPrescriptionStatusRequest(message: string): boolean {
  return /\b(?:prescription\b.*\b(?:status|review|pending|approved|rejected)|(?:status|review|pending|approved|rejected)\b.*\bprescription)\b/i.test(message)
    || new RegExp(`\\bcheck\\s+prescription(?:\\s+id)?\\s+${UUID_PATTERN}\\b`, "i").test(message);
}

function isOrderStatusRequest(message: string): boolean {
  return /\b(?:order\b.*\b(?:status|state|progress)|(?:status|state|progress)\b.*\border)\b/i.test(message)
    || new RegExp(`\\bcheck\\s+order(?:\\s+id)?\\s+${UUID_PATTERN}\\b`, "i").test(message);
}

function isDeliveryTrackingRequest(message: string): boolean {
  return /\b(?:where|track)\b.*\b(?:order|delivery|rider)\b/i.test(message) || /\bdelivery\s+(?:tracking|status)\b/i.test(message);
}

function isSupportRequest(message: string): boolean {
  return /\b(?:complaint|support)\b/i.test(message) || SUPPORT_CATEGORIES.some(([, pattern]) => pattern.test(message));
}

function extractSupportCategory(message: string): string | undefined {
  return SUPPORT_CATEGORIES.find(([, pattern]) => pattern.test(message))?.[0];
}

function isPharmacyDiscoveryRequest(message: string): boolean {
  return /\b(?:find|show|search(?:\s+for)?|locate)\b.*\bpharmac(?:y|ies)\b|\bnearby\s+pharmac(?:y|ies)\b/i.test(message);
}

function isMedicineDiscoveryRequest(message: string, medicineName: string | undefined): boolean {
  return medicineName !== undefined || /\b(?:medicine|medication|drug)\s+(?:availability|stock)\b/i.test(message);
}

export function extractExplicitId(message: string, subject: "order" | "prescription"): string | undefined {
  const marked = new RegExp(`\\b${subject}\\s+(?:id|number|#)\\s*[:#-]?\\s*([a-z0-9-]+)\\b`, "i").exec(message)?.[1];
  if (marked) return marked;
  return new RegExp(`\\b${subject}\\s+(${UUID_PATTERN})\\b`, "i").exec(message)?.[1];
}

export function extractMedicineName(message: string): string | undefined {
  const patterns = [
    /\b(?:find|search(?:\s+for)?|locate)\s+(.+?)(?:\s+near\s+me|\s+nearby|$)/i,
    /\bis\s+([a-z0-9][a-z0-9 .-]{1,60}?)\s+(?:available|in\s+stock)\b/i,
    /\bcheck\s+stock\s+for\s+(.+?)$/i,
  ];
  for (const pattern of patterns) {
    const value = pattern.exec(message)?.[1]?.trim().replace(/[?.!,]+$/, "");
    if (value) return value;
  }
  return undefined;
}

/** Delivery UUIDs do not inherit Commerce version/variant restrictions. */
function extractDeliveryOrderId(message: string): string | undefined {
  const marked = /\border\s+(?:id|number|#)\s*[:#-]?\s*([a-z0-9-]+)\b/i.exec(message)?.[1];
  if (marked) return marked;
  return /\border\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![a-z0-9-])/i.exec(message)?.[1];
}
