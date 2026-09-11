import assert from "node:assert/strict";
import { PrescriptionStatus } from "../generated/prisma/client.js";
import { describe, test } from "vitest";
import { createPrescriptionContextAdapter, createTrustedAssistantContext, type PrescriptionContextDependencies } from "../src/modules/intelligence-experience/index.js";
import { ApiError } from "../src/utils/ApiError.js";

const customerId = "11111111-1111-4111-8111-111111111111";
const prescriptionId = "33333333-3333-4333-8333-333333333333";
const context = createTrustedAssistantContext({ userId: customerId, roles: ["CUSTOMER"] }, "request-1");
const uploadedAt = new Date("2026-09-01T10:00:00.000Z");

function prescription(status: PrescriptionStatus = PrescriptionStatus.PENDING_REVIEW) {
  return { id: prescriptionId, orderId: "order-private", fileUrl: "private-url", originalFilename: "private.pdf", status, uploadedAt, reviewedAt: status === PrescriptionStatus.PENDING_REVIEW ? null : uploadedAt, reviewNotes: "Recorded note", rejectionReason: status === PrescriptionStatus.REJECTED ? "Image unclear" : null };
}

function dependency(operation: PrescriptionContextDependencies["getCustomerPrescription"]): PrescriptionContextDependencies {
  return { getCustomerPrescription: operation };
}

describe("prescription context adapter", () => {
  test.each([PrescriptionStatus.PENDING_REVIEW, PrescriptionStatus.APPROVED, PrescriptionStatus.REJECTED, PrescriptionStatus.ADDITIONAL_INFO_REQUIRED])("uses trusted identity and maps %s safely", async (status) => {
    let identity = "";
    const adapter = createPrescriptionContextAdapter(dependency(async (receivedCustomer) => { identity = receivedCustomer; return prescription(status); }));
    const result = await adapter.getPrescriptionStatus(` ${prescriptionId} `, context);
    assert.equal(identity, customerId);
    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.equal(result.data.prescription.status, status);
    assert.equal(result.data.prescription.uploadedAt, uploadedAt.toISOString());
    assert.equal(result.data.prescription.reviewNotes, "Recorded note");
    if (status === PrescriptionStatus.REJECTED) assert.equal(result.data.prescription.rejectionReason, "Image unclear");
    const serialized = JSON.stringify(result.data);
    for (const privateValue of [prescriptionId, "order-private", "private-url", "private.pdf", "reviewerStaffId", "storagePath"]) assert.equal(serialized.includes(privateValue), false);
  });

  test("rejects missing and malformed identifiers before Prescription", async () => {
    let calls = 0;
    const adapter = createPrescriptionContextAdapter(dependency(async () => { calls += 1; return prescription(); }));
    for (const value of ["", "not-a-uuid"]) {
      const result = await adapter.getPrescriptionStatus(value, context);
      assert.equal(result.status, "error");
      if (result.status === "error") assert.equal(result.code, "invalid_request");
    }
    assert.equal(calls, 0);
  });

  test("preserves ownership-safe not-found and hides unexpected errors", async () => {
    const missing = await createPrescriptionContextAdapter(dependency(async () => { throw new ApiError(404, "Prescription not found.", "PRESCRIPTION_NOT_FOUND"); })).getPrescriptionStatus(prescriptionId, context);
    assert.equal(missing.status, "error");
    if (missing.status === "error") assert.equal(missing.code, "not_found");
    const failed = await createPrescriptionContextAdapter(dependency(async () => { throw new Error("private database failure"); })).getPrescriptionStatus(prescriptionId, context);
    assert.deepEqual(failed, { status: "error", code: "execution_failed", message: "Prescription information could not be retrieved." });
  });
});
