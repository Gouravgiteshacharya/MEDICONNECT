export type AssistantChannel = "text" | "voice";

/** User-controlled input. Identity and roles deliberately do not belong here. */
export interface AssistantRequest {
  readonly message: string;
  readonly channel: AssistantChannel;
  readonly correlationId?: string;
}

const trustedContextBrand: unique symbol = Symbol("TrustedAssistantContext");

/** Opaque server-derived context; construct it only after authentication. */
export interface TrustedAssistantContext {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly requestId: string;
  readonly [trustedContextBrand]: true;
}

export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly roles: readonly string[];
}

export function createTrustedAssistantContext(
  principal: AuthenticatedPrincipal,
  requestId: string,
): TrustedAssistantContext {
  if (!principal.userId.trim() || !requestId.trim()) {
    throw new Error("Authenticated userId and requestId are required");
  }

  return Object.freeze({
    userId: principal.userId,
    roles: Object.freeze([...principal.roles]),
    requestId,
    [trustedContextBrand]: true as const,
  });
}

export type AssistantIntent = 
  | "medicine_discovery"
  | "pharmacy_discovery"
  | "prescription_workflow"
  | "prescription_status"
  | "order_status"
  | "delivery_tracking"
  | "support_request"
  | "clinical_decision"
  | "unknown";
  

export interface SuggestedAssistantAction {
  readonly id: string;
  readonly label: string;
  readonly kind: "navigate" | "submit" | "contact_professional";
  readonly target?: string;
}

export type ToolErrorCode =
  | "unavailable"
  | "not_found"
  | "forbidden"
  | "invalid_request"
  | "execution_failed";

export type ToolExecutionResult<T> =
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "error"; readonly code: ToolErrorCode; readonly message: string };

export interface AssistantTool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  execute(
    input: TInput,
    context: TrustedAssistantContext,
  ): Promise<ToolExecutionResult<TOutput>>;
}

export interface AssistantResponse {
  readonly status: "fulfilled" | "refused" | "unsupported" | "error";
  readonly intent: AssistantIntent;
  readonly message: string;
  readonly suggestedActions: readonly SuggestedAssistantAction[];
  readonly toolResult?: ToolExecutionResult<unknown>;
}

export interface MedicineDiscoveryQuery {
  readonly discoveryType: "medicine" | "pharmacy";
  readonly medicineName?: string;
  readonly radiusKm?: number;
}

export type MedicineDiscoveryToolInput = MedicineDiscoveryQuery;

export interface OrderContextToolInput {
  readonly orderId?: string;
}

export interface PrescriptionContextToolInput {
  readonly prescriptionId?: string;
}

export interface DeliveryTrackingToolInput {
  readonly orderId?: string;
}

export interface SupportToolInput {
  readonly orderId?: string;
  readonly category?: string;
  readonly details?: string;
}

export interface MedicineDiscoveryData {
  readonly medicine: {
    readonly name: string;
    readonly brandName: string | null;
    readonly genericName: string | null;
    readonly requiresPrescription: boolean;
  };
  readonly pharmacies: readonly {
    readonly name: string;
    readonly address: {
      readonly addressLine1: string;
      readonly addressLine2: string | null;
      readonly city: string;
      readonly state: string;
      readonly postalCode: string;
    };
    readonly availability: "AVAILABLE" | "LOW_STOCK";
    readonly quantity: number;
    readonly sellingPrice: string;
    readonly distanceKm: number;
    readonly inventory: {
      readonly freshness: "FRESH" | "STALE";
      readonly lastUpdated: string;
    };
  }[];
  readonly radiusKm: number;
}

export interface MedicineDiscoveryAdapter {
  discover(
    query: MedicineDiscoveryQuery,
    context: TrustedAssistantContext,
  ): Promise<ToolExecutionResult<MedicineDiscoveryData>>;
}

export interface OrderContextAdapter {
  getOrder(orderId: string, context: TrustedAssistantContext): Promise<ToolExecutionResult<unknown>>;
}

export interface PrescriptionContextAdapter {
  getPrescriptionStatus(
    prescriptionId: string,
    context: TrustedAssistantContext,
  ): Promise<ToolExecutionResult<unknown>>;
}

export interface DeliveryTrackingAdapter {
  getTracking(orderId: string, context: TrustedAssistantContext): Promise<ToolExecutionResult<unknown>>;
}

export interface SupportAdapter {
  createSupportRequest(
    input: Readonly<{ orderId?: string; category: string; details: string }>,
    context: TrustedAssistantContext,
  ): Promise<ToolExecutionResult<unknown>>;
}

export interface AIProvider {
  generateOperationalReply(
    request: AssistantRequest,
    context: TrustedAssistantContext,
  ): Promise<ToolExecutionResult<string>>;
}

export interface VoiceProvider {
  transcribe(audio: Uint8Array): Promise<ToolExecutionResult<string>>;
  synthesize(text: string): Promise<ToolExecutionResult<Uint8Array>>;
}

export interface Prediction<T> {
  readonly value: T;
  readonly source: "model" | "deterministic_fallback";
  readonly advisory: true;
}

export interface EtaPredictor<TInput> {
  predictEta(input: TInput): Promise<Prediction<Readonly<{ minutes: number }>>>;
}

export interface RiderSuitabilityPredictor<TInput> {
  predictSuitability(input: TInput): Promise<Prediction<Readonly<{ score: number }>>>;
}

export type OperationalRiskLevel = "low" | "medium" | "high";

export interface OperationalRiskScorer<TInput> {
  scoreOperationalRisk(
    input: TInput,
  ): Promise<Prediction<Readonly<{ score: number; level: OperationalRiskLevel; reviewRecommended: boolean }>>>;
}
