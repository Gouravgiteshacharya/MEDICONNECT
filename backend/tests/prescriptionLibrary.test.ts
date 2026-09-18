import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  PharmacyStaffRole,
  PrescriptionStatus,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";

const storageMocks = vi.hoisted(() => ({
  upload: vi.fn(),
  delete: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("../src/services/prescriptionStorage.service.js", () => ({
  prescriptionStorage: storageMocks,
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    prescription: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    pharmacyStaff: { findFirst: vi.fn() },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  prescription: { findMany: Mock; findFirst: Mock; findUnique: Mock };
  pharmacyStaff: { findFirst: Mock };
};

const customerId = "11111111-1111-4111-8111-111111111111";
const otherCustomerId = "22222222-2222-4222-8222-222222222222";
const staffUserId = "33333333-3333-4333-8333-333333333333";
const pharmacyId = "44444444-4444-4444-8444-444444444444";
const prescriptionId = "55555555-5555-4555-8555-555555555555";
const orderId = "66666666-6666-4666-8666-666666666666";
const storagePath = `prescriptions/${customerId}/${orderId}/${prescriptionId}/document.pdf`;

function auth(userId = customerId, role: UserRole = UserRole.CUSTOMER) {
  prismaMock.user.findUnique.mockResolvedValueOnce({ id: userId, role, isActive: true });
  return `Bearer ${signAuthToken({ userId, role })}`;
}

function libraryPrescription(overrides: Record<string, unknown> = {}) {
  return {
    id: prescriptionId,
    orderId,
    originalFilename: "prescription.pdf",
    status: PrescriptionStatus.PENDING_REVIEW,
    uploadedAt: new Date("2026-09-18T10:00:00.000Z"),
    reviewedAt: null,
    reviewNotes: null,
    rejectionReason: null,
    supersedesPrescriptionId: null,
    supersededByPrescription: null,
    order: { id: orderId, orderNumber: "MC-ORDER-1" },
    ...overrides,
  };
}

function accessibleDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: prescriptionId,
    storagePath,
    order: { customerId, pharmacyId },
    ...overrides,
  };
}

function expectError(response: { status: number; body: unknown }, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.body).toEqual(expect.objectContaining({ code }));
}

describe("customer prescription library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.createSignedUrl.mockResolvedValue(
      "https://storage.example.test/signed/document?token=short-lived",
    );
  });

  it("requires an authenticated CUSTOMER for list and detail", async () => {
    expect((await request(app).get("/api/v1/prescriptions")).status).toBe(401);
    const forbidden = await request(app)
      .get(`/api/v1/prescriptions/${prescriptionId}`)
      .set("Authorization", auth(staffUserId, UserRole.PHARMACY_STAFF));
    expect(forbidden.status).toBe(403);
  });

  it("lists only prescriptions on the authenticated customer's orders", async () => {
    prismaMock.prescription.findMany.mockResolvedValue([libraryPrescription()]);
    const response = await request(app)
      .get("/api/v1/prescriptions")
      .set("Authorization", auth());
    expect(response.status).toBe(200);
    expect(response.body.nextCursor).toBeNull();
    expect(response.body.prescriptions).toHaveLength(1);
    const args = prismaMock.prescription.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ order: { customerId } });
    expect(args.take).toBe(21);
    expect(args.orderBy).toEqual([{ uploadedAt: "desc" }, { id: "desc" }]);
    expect(args.select).not.toHaveProperty("storagePath");
    expect(args.select).not.toHaveProperty("reviewerStaffId");
  });

  it("returns owned detail with safe supersession metadata", async () => {
    prismaMock.prescription.findFirst.mockResolvedValue(
      libraryPrescription({
        supersedesPrescriptionId: "77777777-7777-4777-8777-777777777777",
        supersededByPrescription: {
          id: "88888888-8888-4888-8888-888888888888",
          status: PrescriptionStatus.PENDING_REVIEW,
          uploadedAt: new Date("2026-09-18T11:00:00.000Z"),
        },
      }),
    );
    const response = await request(app)
      .get(`/api/v1/prescriptions/${prescriptionId}`)
      .set("Authorization", auth());
    expect(response.status).toBe(200);
    expect(response.body.prescription.supersedesPrescriptionId).toBeTruthy();
    expect(response.body.prescription.supersededByPrescription.id).toBeTruthy();
    expect(response.body.prescription).not.toHaveProperty("storagePath");
    expect(response.body.prescription).not.toHaveProperty("reviewerStaffId");
    expect(response.body.prescription).not.toHaveProperty("fileUrl");
    expect(prismaMock.prescription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: prescriptionId, order: { customerId } },
      }),
    );
  });

  it("does not leak cross-customer detail", async () => {
    prismaMock.prescription.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .get(`/api/v1/prescriptions/${prescriptionId}`)
      .set("Authorization", auth(otherCustomerId));
    expectError(response, 404, "PRESCRIPTION_NOT_FOUND");
  });

  it("validates library query and detail UUID strictly", async () => {
    const badLimit = await request(app)
      .get("/api/v1/prescriptions?limit=51")
      .set("Authorization", auth());
    expectError(badLimit, 400, "VALIDATION_ERROR");
    const badId = await request(app)
      .get("/api/v1/prescriptions/not-a-uuid")
      .set("Authorization", auth());
    expectError(badId, 400, "VALIDATION_ERROR");
  });
});

describe("private prescription document access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.createSignedUrl.mockResolvedValue(
      "https://storage.example.test/signed/document?token=short-lived",
    );
  });

  it("allows the owning customer and returns short-lived access only", async () => {
    prismaMock.prescription.findUnique.mockResolvedValue(accessibleDocument());
    const response = await request(app)
      .get(`/api/v1/prescriptions/${prescriptionId}/document-access`)
      .set("Authorization", auth());
    expect(response.status).toBe(200);
    expect(response.body.documentAccess.url).toContain("signed/document");
    expect(response.body.documentAccess.expiresAt).toEqual(expect.any(String));
    expect(storageMocks.createSignedUrl).toHaveBeenCalledWith(storagePath, 300);
    expect(JSON.stringify(response.body)).not.toContain("service-role");
    expect(JSON.stringify(response.body)).not.toContain(storagePath);
  });

  it("denies a cross-customer before requesting a signed URL", async () => {
    prismaMock.prescription.findUnique.mockResolvedValue(accessibleDocument());
    const response = await request(app)
      .get(`/api/v1/prescriptions/${prescriptionId}/document-access`)
      .set("Authorization", auth(otherCustomerId));
    expectError(response, 404, "PRESCRIPTION_NOT_FOUND");
    expect(storageMocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("allows active exact-pharmacy staff", async () => {
    prismaMock.prescription.findUnique.mockResolvedValue(accessibleDocument());
    prismaMock.pharmacyStaff.findFirst.mockResolvedValue({
      id: "99999999-9999-4999-8999-999999999999",
      userId: staffUserId,
      pharmacyId,
      role: PharmacyStaffRole.STAFF,
    });
    const response = await request(app)
      .get(`/api/v1/prescriptions/${prescriptionId}/document-access`)
      .set("Authorization", auth(staffUserId, UserRole.PHARMACY_STAFF));
    expect(response.status).toBe(200);
    expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: staffUserId, pharmacyId, isActive: true },
      }),
    );
  });

  it.each(["missing", "cross-pharmacy"])(
    "denies %s pharmacy membership before signing",
    async () => {
      prismaMock.prescription.findUnique.mockResolvedValue(accessibleDocument());
      prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);
      const response = await request(app)
        .get(`/api/v1/prescriptions/${prescriptionId}/document-access`)
        .set("Authorization", auth(staffUserId, UserRole.PHARMACY_STAFF));
      expectError(response, 404, "PRESCRIPTION_NOT_FOUND");
      expect(storageMocks.createSignedUrl).not.toHaveBeenCalled();
    },
  );

  it.each([UserRole.DELIVERY_PARTNER, UserRole.ADMIN])(
    "denies %s without querying storage",
    async (role) => {
      const response = await request(app)
        .get(`/api/v1/prescriptions/${prescriptionId}/document-access`)
        .set("Authorization", auth(staffUserId, role));
      expectError(response, 403, "FORBIDDEN");
      expect(prismaMock.prescription.findUnique).not.toHaveBeenCalled();
      expect(storageMocks.createSignedUrl).not.toHaveBeenCalled();
    },
  );

  it("handles legacy unmanaged documents without manufacturing access", async () => {
    prismaMock.prescription.findUnique.mockResolvedValue(
      accessibleDocument({ storagePath: null }),
    );
    const response = await request(app)
      .get(`/api/v1/prescriptions/${prescriptionId}/document-access`)
      .set("Authorization", auth());
    expectError(response, 409, "PRESCRIPTION_DOCUMENT_UNAVAILABLE");
    expect(storageMocks.createSignedUrl).not.toHaveBeenCalled();
  });
});
