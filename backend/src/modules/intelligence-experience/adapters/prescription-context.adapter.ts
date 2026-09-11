import { getCustomerPrescription } from "../../../services/prescription.service.js";
import { ApiError } from "../../../utils/ApiError.js";
import { uuidSchema } from "../../../validators/common.schemas.js";
import type { PrescriptionContextAdapter, PrescriptionStatusData, ToolExecutionResult } from "../contracts.js";

export interface PrescriptionContextDependencies {
  readonly getCustomerPrescription: typeof getCustomerPrescription;
}

export function createPrescriptionContextAdapter(
  dependencies: PrescriptionContextDependencies = { getCustomerPrescription },
): PrescriptionContextAdapter {
  return {
    async getPrescriptionStatus(prescriptionId, context) {
      const normalizedId = prescriptionId.trim();
      if (!uuidSchema.safeParse(normalizedId).success) {
        return error("invalid_request", "Please provide a valid prescription ID.");
      }
      try {
        const prescription = await dependencies.getCustomerPrescription(context.userId, normalizedId);
        return {
          status: "success",
          data: {
            prescription: {
              status: prescription.status,
              uploadedAt: prescription.uploadedAt.toISOString(),
              reviewedAt: prescription.reviewedAt?.toISOString() ?? null,
              reviewNotes: prescription.reviewNotes,
              rejectionReason: prescription.rejectionReason,
            },
          },
        };
      } catch (caught) {
        return translateError(caught);
      }
    },
  };
}

function translateError(caught: unknown): ToolExecutionResult<never> {
  if (caught instanceof ApiError) {
    if (caught.code === "PRESCRIPTION_NOT_FOUND") return error("not_found", "Prescription not found.");
    if (caught.code === "FORBIDDEN") return error("forbidden", "You do not have access to this prescription.");
    if (caught.code === "UNAVAILABLE" || caught.code === "SERVICE_UNAVAILABLE") return error("unavailable", "Prescription information is currently unavailable.");
  }
  return error("execution_failed", "Prescription information could not be retrieved.");
}

function error(code: "invalid_request" | "not_found" | "forbidden" | "unavailable" | "execution_failed", message: string): ToolExecutionResult<never> {
  return { status: "error", code, message };
}
