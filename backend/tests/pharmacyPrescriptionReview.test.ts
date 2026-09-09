import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  OrderStatus,
  PharmacyStaffRole,
  PrescriptionStatus,
  Prisma,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import {
  MAX_PHARMACY_WORKFLOW_ATTEMPTS,
  reviewPharmacyPrescription,
} from "../src/services/pharmacyWorkflow.service.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    pharmacyStaff: { findFirst: vi.fn() },
    prescription: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    order: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const { prisma } = await import("../src/lib/prisma.js");
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  pharmacyStaff: { findFirst: Mock };
  prescription: {
    findFirst: Mock;
    findMany: Mock;
    findUnique: Mock;
    updateMany: Mock;
  };
  order: { updateMany: Mock };
  $transaction: Mock;
};

const userId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const otherPharmacyId = "33333333-3333-4333-8333-333333333333";
const staffId = "44444444-4444-4444-8444-444444444444";
const prescriptionId = "55555555-5555-4555-8555-555555555555";
const orderId = "66666666-6666-4666-8666-666666666666";
const reviewedAt = new Date("2026-08-31T12:00:00.000Z");

function authHeader(role: UserRole = UserRole.PHARMACY_STAFF) {
  prismaMock.user.findUnique.mockResolvedValueOnce({ id: userId, role, isActive: true });
  return `Bearer ${signAuthToken({ userId, role })}`;
}

function membership(role: PharmacyStaffRole = PharmacyStaffRole.PHARMACIST) {
  prismaMock.pharmacyStaff.findFirst.mockResolvedValue({
    id: staffId,
    userId,
    pharmacyId,
    role,
  });
}

function currentPrescription(overrides: Record<string, unknown> = {}) {
  return {
    id: prescriptionId,
    orderId,
    status: PrescriptionStatus.PENDING_REVIEW,
    order: { status: OrderStatus.PRESCRIPTION_PENDING },
    ...overrides,
  };
}

function reviewedPrescription(overrides: Record<string, unknown> = {}) {
  return {
    id: prescriptionId,
    orderId,
    fileUrl: "https://files.example.test/rx.pdf",
    originalFilename: "rx.pdf",
    status: PrescriptionStatus.APPROVED,
    uploadedAt: new Date("2026-08-31T10:00:00.000Z"),
    reviewedAt,
    reviewerStaffId: staffId,
    reviewNotes: null,
    rejectionReason: null,
    ...overrides,
  };
}

function mockReviewSuccess(
  statuses: PrescriptionStatus[] = [PrescriptionStatus.APPROVED],
) {
  membership();
  prismaMock.prescription.findFirst.mockResolvedValue(currentPrescription());
  prismaMock.prescription.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.prescription.findMany.mockResolvedValue(
    statuses.map((status) => ({ status })),
  );
  prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.prescription.findUnique.mockResolvedValue(reviewedPrescription());
}

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: "test",
  });
}

function expectError(response: { status: number; body: unknown }, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.body).toEqual(expect.objectContaining({ code }));
}

describe("pharmacy prescription review API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prisma));
  });

  it("rejects unauthenticated and customer requests", async () => {
    const path = `/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`;
    expect((await request(app).patch(path).send({ status: "APPROVED" })).status).toBe(401);
    const customer = await request(app)
      .patch(path)
      .set("Authorization", authHeader(UserRole.CUSTOMER))
      .send({ status: "APPROVED" });
    expect(customer.status).toBe(403);
    expect(prismaMock.pharmacyStaff.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    PharmacyStaffRole.OWNER,
    PharmacyStaffRole.MANAGER,
    PharmacyStaffRole.STAFF,
  ])("forbids %s from prescription decisions", async (role) => {
    membership(role);
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED" });
    expectError(response, 403, "FORBIDDEN");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.prescription.findFirst).not.toHaveBeenCalled();
  });

  it("forbids missing or inactive membership", async () => {
    prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED" });
    expectError(response, 403, "FORBIDDEN");
    expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId, pharmacyId, isActive: true } }),
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid pharmacy UUID", "bad", prescriptionId, { status: "APPROVED" }],
    ["invalid prescription UUID", pharmacyId, "bad", { status: "APPROVED" }],
    ["invalid status", pharmacyId, prescriptionId, { status: "PENDING_REVIEW" }],
    ["unknown field", pharmacyId, prescriptionId, { status: "APPROVED", orderId }],
    ["missing rejection reason", pharmacyId, prescriptionId, { status: "REJECTED" }],
    ["missing additional-info notes", pharmacyId, prescriptionId, { status: "ADDITIONAL_INFO_REQUIRED" }],
    ["spoofed reviewer", pharmacyId, prescriptionId, { status: "APPROVED", reviewerStaffId: staffId }],
  ])("rejects %s", async (_name, pharmacy, prescription, body) => {
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacy}/prescriptions/${prescription}/review`)
      .set("Authorization", authHeader())
      .send(body);
    expectError(response, 400, "VALIDATION_ERROR");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("hides a cross-pharmacy prescription", async () => {
    membership();
    prismaMock.prescription.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED" });
    expectError(response, 404, "PRESCRIPTION_NOT_FOUND");
    expect(prismaMock.prescription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: prescriptionId, order: { pharmacyId } } }),
    );
  });

  it("allows an exact-pharmacy pharmacist and sets server review identity", async () => {
    mockReviewSuccess();
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED", reviewNotes: " Valid prescription " });
    expect(response.status).toBe(200);
    expect(response.body.prescription.status).toBe(PrescriptionStatus.APPROVED);
    expect(prismaMock.prescription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewerStaffId: staffId,
          reviewNotes: "Valid prescription",
          rejectionReason: null,
        }),
      }),
    );
    expect(prismaMock.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });

  it("allows re-review after additional information was requested", async () => {
    mockReviewSuccess();
    prismaMock.prescription.findFirst.mockResolvedValue(
      currentPrescription({ status: PrescriptionStatus.ADDITIONAL_INFO_REQUIRED }),
    );
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED" });
    expect(response.status).toBe(200);
    expect(prismaMock.prescription.updateMany).toHaveBeenCalledTimes(1);
  });

  it("stores a rejection reason and aggregates any rejection", async () => {
    mockReviewSuccess([PrescriptionStatus.APPROVED, PrescriptionStatus.REJECTED]);
    prismaMock.prescription.findUnique.mockResolvedValue(
      reviewedPrescription({ status: PrescriptionStatus.REJECTED, rejectionReason: "Unreadable" }),
    );
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "REJECTED", rejectionReason: " Unreadable " });
    expect(response.status).toBe(200);
    expect(prismaMock.prescription.updateMany.mock.calls[0][0].data.rejectionReason).toBe("Unreadable");
    expect(prismaMock.order.updateMany.mock.calls[0][0].data.status).toBe(OrderStatus.PRESCRIPTION_REJECTED);
  });

  it.each([
    ["additional info", [PrescriptionStatus.ADDITIONAL_INFO_REQUIRED], OrderStatus.PRESCRIPTION_PENDING],
    ["approved plus pending", [PrescriptionStatus.APPROVED, PrescriptionStatus.PENDING_REVIEW], OrderStatus.PRESCRIPTION_PENDING],
    ["all approved", [PrescriptionStatus.APPROVED, PrescriptionStatus.APPROVED], OrderStatus.PRESCRIPTION_APPROVED],
  ] as const)("aggregates %s correctly", async (_name, statuses, expectedStatus) => {
    mockReviewSuccess([...statuses]);
    const body = statuses[0] === PrescriptionStatus.ADDITIONAL_INFO_REQUIRED
      ? { status: "ADDITIONAL_INFO_REQUIRED", reviewNotes: "Please upload a clearer image" }
      : { status: "APPROVED" };
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send(body);
    expect(response.status).toBe(200);
    expect(prismaMock.order.updateMany.mock.calls[0][0].data.status).toBe(expectedStatus);
  });

  it.each([PrescriptionStatus.APPROVED, PrescriptionStatus.REJECTED])(
    "does not overwrite finalized %s",
    async (status) => {
      membership();
      prismaMock.prescription.findFirst.mockResolvedValue(currentPrescription({ status }));
      const response = await request(app)
        .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
        .set("Authorization", authHeader())
        .send({ status: "APPROVED" });
      expectError(response, 409, "PRESCRIPTION_ALREADY_FINALIZED");
      expect(prismaMock.prescription.updateMany).not.toHaveBeenCalled();
    },
  );

  it("blocks review after the order leaves prescription pending", async () => {
    membership();
    prismaMock.prescription.findFirst.mockResolvedValue(
      currentPrescription({ order: { status: OrderStatus.CONFIRMED } }),
    );
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED" });
    expectError(response, 409, "PRESCRIPTION_REVIEW_NOT_ALLOWED");
  });

  it("classifies a conditional-update finalization race", async () => {
    mockReviewSuccess();
    prismaMock.prescription.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.prescription.findFirst
      .mockResolvedValueOnce(currentPrescription())
      .mockResolvedValueOnce(currentPrescription({ status: PrescriptionStatus.REJECTED }));
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED" });
    expectError(response, 409, "PRESCRIPTION_ALREADY_FINALIZED");
  });

  it("retries exact P2034 and re-reads state", async () => {
    mockReviewSuccess();
    prismaMock.prescription.findFirst
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce(currentPrescription());
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED" });
    expect(response.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMock.prescription.findFirst).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["missing", null],
    [
      "wrong-role",
      {
        id: staffId,
        userId,
        pharmacyId,
        role: PharmacyStaffRole.STAFF,
      },
    ],
  ])("fails safely when membership becomes %s before retry", async (_name, retryMembership) => {
    prismaMock.pharmacyStaff.findFirst
      .mockResolvedValueOnce({
        id: staffId,
        userId,
        pharmacyId,
        role: PharmacyStaffRole.PHARMACIST,
      })
      .mockResolvedValueOnce(retryMembership);
    prismaMock.prescription.findFirst.mockRejectedValueOnce(knownError("P2034"));

    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED" });

    expectError(response, 403, "FORBIDDEN");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMock.prescription.updateMany).not.toHaveBeenCalled();
  });

  it("uses reviewer identity from the successful retry membership", async () => {
    const retryStaffId = "77777777-7777-4777-8777-777777777777";
    prismaMock.pharmacyStaff.findFirst
      .mockResolvedValueOnce({
        id: staffId,
        userId,
        pharmacyId,
        role: PharmacyStaffRole.PHARMACIST,
      })
      .mockResolvedValueOnce({
        id: retryStaffId,
        userId,
        pharmacyId,
        role: PharmacyStaffRole.PHARMACIST,
      });
    prismaMock.prescription.findFirst
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce(currentPrescription());
    prismaMock.prescription.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.prescription.findMany.mockResolvedValue([
      { status: PrescriptionStatus.APPROVED },
    ]);
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.prescription.findUnique.mockResolvedValue(
      reviewedPrescription({ reviewerStaffId: retryStaffId }),
    );

    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED" });

    expect(response.status).toBe(200);
    expect(prismaMock.prescription.updateMany.mock.calls[0][0].data.reviewerStaffId).toBe(
      retryStaffId,
    );
  });

  it("stops when order state changes during retry", async () => {
    membership();
    prismaMock.prescription.findFirst
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce(currentPrescription({ order: { status: OrderStatus.CONFIRMED } }));
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED" });
    expectError(response, 409, "PRESCRIPTION_REVIEW_NOT_ALLOWED");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(prismaMock.prescription.updateMany).not.toHaveBeenCalled();
  });

  it("returns conflict after exactly three P2034 attempts", async () => {
    membership();
    prismaMock.prescription.findFirst.mockRejectedValue(knownError("P2034"));
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`)
      .set("Authorization", authHeader())
      .send({ status: "APPROVED" });
    expectError(response, 409, "PRESCRIPTION_REVIEW_CONFLICT");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(MAX_PHARMACY_WORKFLOW_ATTEMPTS);
  });

  it("does not retry unrelated errors", async () => {
    const failure = new Error("database unavailable");
    const membershipReader = vi.fn().mockResolvedValue({
      id: staffId, userId, pharmacyId, role: PharmacyStaffRole.PHARMACIST,
    });
    prismaMock.$transaction.mockRejectedValue(failure);
    await expect(
      reviewPharmacyPrescription(
        userId,
        pharmacyId,
        prescriptionId,
        { status: PrescriptionStatus.APPROVED },
        prisma as never,
        membershipReader,
      ),
    ).rejects.toBe(failure);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
