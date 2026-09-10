import type { AssistantIntent, SuggestedAssistantAction } from "./contracts.js";

export type SafetyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly message: string; readonly actions: readonly SuggestedAssistantAction[] };

const SAFE_CLINICAL_REFUSAL =
  "The MediConnect assistant can help with platform and customer-service tasks, but it cannot make medical decisions, recommend medicines or dosage, or assess a prescription clinically. Please ask an appropriate doctor or pharmacist for medical guidance.";

export function evaluateAssistantSafety(intent: AssistantIntent): SafetyDecision {
  if (intent !== "clinical_decision") return { allowed: true };

  return {
    allowed: false,
    message: SAFE_CLINICAL_REFUSAL,
    actions: [{ id: "contact-healthcare-professional", label: "Contact a doctor or pharmacist", kind: "contact_professional" }],
  };
}
