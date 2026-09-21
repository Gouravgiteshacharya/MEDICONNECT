import type {
  AIProvider,
  AssistantRequest,
  AssistantResponse,
  AssistantResponder,
  MedicineDiscoveryData,
  OperationalReplyInput,
  TrustedAssistantContext,
} from "./contracts.js";


const MAX_ENHANCED_MESSAGE_LENGTH = 2000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 5000;

export class OperationalReplyEnhancer implements AssistantResponder {
  readonly #assistant: AssistantResponder;
  readonly #provider?: AIProvider;
  readonly #providerTimeoutMs: number;

  constructor(
    assistant: AssistantResponder,
    provider?: AIProvider,
    providerTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  ) {
    this.#assistant = assistant;
    this.#provider = provider;
    this.#providerTimeoutMs = providerTimeoutMs;
  }

  async respond(
    request: AssistantRequest,
    context: TrustedAssistantContext,
  ): Promise<AssistantResponse> {
    const deterministicResponse = await this.#assistant.respond(request, context);
    const input = buildOperationalReplyInput(deterministicResponse);

    if (!this.#provider || !input) {
      return deterministicResponse;
    }

    try {
      const enhanced = await withTimeout(
        this.#provider.generateOperationalReply(input),
        this.#providerTimeoutMs,
      );

      if (
        enhanced.status !== "success" ||
        typeof enhanced.data !== "string"
      ) {
        return deterministicResponse;
      }

      const message = enhanced.data.trim();
      if (
        message.length === 0 ||
        message.length > MAX_ENHANCED_MESSAGE_LENGTH
      ) {
        return deterministicResponse;
      }

      return {
        ...deterministicResponse,
        message,
      };
    } catch {
      return deterministicResponse;
    }
  }
}

function buildOperationalReplyInput(
  response: AssistantResponse,
): OperationalReplyInput | null {
  if (
    response.status !== "fulfilled" ||
    response.intent !== "medicine_discovery" ||
    response.toolResult?.status !== "success" ||
    !isMedicineDiscoveryData(response.toolResult.data)
  ) {
    return null;
  }

  const data = response.toolResult.data;

  return {
    intent: "medicine_discovery",
    medicine: {
      name: data.medicine.name,
      reportingPharmacyCount: data.pharmacies.length,
      radiusKm: data.radiusKm,
      hasStaleAvailability: data.pharmacies.some(
        ({ inventory }) => inventory.freshness === "STALE",
      ),
      requiresPrescription: data.medicine.requiresPrescription,
    },
  };
}

function isMedicineDiscoveryData(data: unknown): data is MedicineDiscoveryData {
  if (!isRecord(data) || !isRecord(data.medicine)) return false;
  if (
    typeof data.medicine.name !== "string" ||
    typeof data.medicine.requiresPrescription !== "boolean" ||
    !Array.isArray(data.pharmacies) ||
    typeof data.radiusKm !== "number"
  ) {
    return false;
  }

  return data.pharmacies.every(
    (pharmacy) =>
      isRecord(pharmacy) &&
      isRecord(pharmacy.inventory) &&
      (pharmacy.inventory.freshness === "FRESH" ||
        pharmacy.inventory.freshness === "STALE"),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Operational reply provider timed out")),
      timeoutMs,
    );

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
