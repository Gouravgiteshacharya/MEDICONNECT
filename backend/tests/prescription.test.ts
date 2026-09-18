import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { OrderStatus, PrescriptionStatus, UserRole } from "../generated/prisma/client.js";
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
    order: { findFirst: vi.fn() },
    prescription: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const { prisma } = await import("../src/lib/prisma.js");
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  order: { findFirst: Mock };
  prescription: { create: Mock; findMany: Mock; findUnique: Mock; findFirst: Mock };
  $transaction: Mock;
};

const customerId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const prescriptionId = "33333333-3333-4333-8333-333333333333";
const previousPrescriptionId = "44444444-4444-4444-8444-444444444444";
const uploadedAt = new Date("2026-08-31T10:00:00.000Z");
const pdf = Buffer.from("%PDF-1.7\nsecure prescription test");
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("image"),
]);

function authenticateAs(role: UserRole = UserRole.CUSTOMER) {
  prismaMock.user.findUnique.mockResolvedValueOnce({ id: customerId, role, isActive: true });
  return `Bearer ${signAuthToken({ userId: customerId, role })}`;
}

function uploadableOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    status: OrderStatus.PRESCRIPTION_PENDING,
    items: [{ id: "55555555-5555-4555-8555-555555555555" }],
    ...overrides,
  };
}

function prescription(overrides: Record<string, unknown> = {}) {
  return {
    id: prescriptionId,
    orderId,
    fileUrl: `/api/v1/prescriptions/${prescriptionId}/document-access`,
    originalFilename: "prescription.pdf",
    status: PrescriptionStatus.PENDING_REVIEW,
    uploadedAt,
    reviewedAt: null,
    reviewNotes: null,
    rejectionReason: null,
    supersedesPrescriptionId: null,
    ...overrides,
  };
}

function uploadRequest(filename = "prescription.pdf", content = pdf, type = "application/pdf") {
  return request(app)
    .post(`/api/v1/orders/${orderId}/prescriptions`)
    .set("Authorization", authenticateAs())
    .attach("file", content, { filename, contentType: type });
}

function expectError(response: { status: number; body: unknown }, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.body).toEqual(expect.objectContaining({ code }));
}

describe("secure customer prescription workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prisma));
    prismaMock.order.findFirst.mockResolvedValue(uploadableOrder());
    prismaMock.prescription.create.mockResolvedValue(prescription());
    storageMocks.upload.mockResolvedValue(undefined);
    storageMocks.delete.mockResolvedValue(undefined);
  });

  it("rejects unauthenticated and non-customer uploads", async () => {
    const unauthenticated = await request(app)
      .post(`/api/v1/orders/${orderId}/prescriptions`)
      .attach("file", pdf, { filename: "rx.pdf", contentType: "application/pdf" });
    expect(unauthenticated.status).toBe(401);

    const forbidden = await request(app)
      .post(`/api/v1/orders/${orderId}/prescriptions`)
      .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF))
      .attach("file", pdf, { filename: "rx.pdf", contentType: "application/pdf" });
    expect(forbidden.status).toBe(403);
    expect(storageMocks.upload).not.toHaveBeenCalled();
  });

  it("uploads a verified document and persists only server-controlled references", async () => {
    const response = await uploadRequest("../unsafe prescription.pdf");
    expect(response.status).toBe(201);
    const stored = storageMocks.upload.mock.calls[0][0];
    expect(stored.key).toMatch(
      new RegExp(`^prescriptions/${customerId}/${orderId}/[0-9a-f-]+/[0-9a-f-]+-unsafe-prescription\\.pdf$`),
    );
    expect(stored.content).toEqual(pdf);
    expect(stored.contentType).toBe("application/pdf");

    const data = prismaMock.prescription.create.mock.calls[0][0].data;
    expect(data.storagePath).toBe(stored.key);
    expect(data.originalFilename).toBe("unsafe-prescription.pdf");
    expect(data.fileUrl).toBe(`/api/v1/prescriptions/${data.id}/document-access`);
    expect(data).not.toHaveProperty("reviewerStaffId");
    expect(data).not.toHaveProperty("reviewedAt");
    expect(prismaMock.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });

  it("generates distinct storage keys for separate uploads", async () => {
    expect((await uploadRequest()).status).toBe(201);
    expect((await uploadRequest("second.pdf")).status).toBe(201);
    const [first, second] = storageMocks.upload.mock.calls.map((call) => call[0].key);
    expect(first).not.toBe(second);
  });

  it.each([
    ["unsupported type", Buffer.from("plain text"), "text/plain"],
    ["PDF MIME with PNG bytes", png, "application/pdf"],
    ["PNG MIME with PDF bytes", pdf, "image/png"],
  ])("rejects %s before storage", async (_name, content, type) => {
    const response = await uploadRequest("document.bin", content, type);
    expectError(response, 415, "PRESCRIPTION_FILE_TYPE_UNSUPPORTED");
    expect(storageMocks.upload).not.toHaveBeenCalled();
  });

  it("rejects missing and oversized files", async () => {
    const missing = await request(app)
      .post(`/api/v1/orders/${orderId}/prescriptions`)
      .set("Authorization", authenticateAs());
    expectError(missing, 400, "VALIDATION_ERROR");

    const oversized = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(10 * 1024 * 1024)]);
    const tooLarge = await uploadRequest("large.pdf", oversized);
    expectError(tooLarge, 413, "PRESCRIPTION_FILE_TOO_LARGE");
    expect(storageMocks.upload).not.toHaveBeenCalled();
  });

  it("does not allow clients to choose storagePath or fileUrl", async () => {
    const response = await uploadRequest()
      .field("storagePath", "another/customer/rx.pdf")
      .field("fileUrl", "https://public.example.test/rx.pdf");
    expectError(response, 400, "VALIDATION_ERROR");
    expect(storageMocks.upload).not.toHaveBeenCalled();
  });

  it("checks order ownership before uploading", async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);
    const response = await uploadRequest();
    expectError(response, 404, "ORDER_NOT_FOUND");
    expect(prismaMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: orderId, customerId } }),
    );
    expect(storageMocks.upload).not.toHaveBeenCalled();
  });

  it.each([
    [uploadableOrder({ items: [] }), "PRESCRIPTION_NOT_REQUIRED"],
    [uploadableOrder({ status: OrderStatus.CONFIRMED }), "PRESCRIPTION_UPLOAD_NOT_ALLOWED"],
  ])("preserves lifecycle eligibility", async (order, code) => {
    prismaMock.order.findFirst.mockResolvedValue(order);
    const response = await uploadRequest();
    expectError(response, 409, code);
    expect(storageMocks.upload).not.toHaveBeenCalled();
  });

  it("does not create metadata when provider upload fails", async () => {
    storageMocks.upload.mockRejectedValue(new Error("provider failed"));
    const response = await uploadRequest();
    expect(response.status).toBe(500);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("deletes the uploaded object when database creation fails", async () => {
    prismaMock.$transaction.mockRejectedValue(new Error("database failed"));
    const response = await uploadRequest();
    expect(response.status).toBe(500);
    expect(storageMocks.delete).toHaveBeenCalledWith(storageMocks.upload.mock.calls[0][0].key);
  });

  it("preserves supersession validation and persistence", async () => {
    prismaMock.prescription.findUnique.mockResolvedValue({
      id: previousPrescriptionId,
      orderId,
      status: PrescriptionStatus.ADDITIONAL_INFO_REQUIRED,
    });
    prismaMock.prescription.findFirst.mockResolvedValue(null);
    prismaMock.prescription.create.mockResolvedValue(
      prescription({ supersedesPrescriptionId: previousPrescriptionId }),
    );
    const response = await uploadRequest().field("supersedesPrescriptionId", previousPrescriptionId);
    expect(response.status).toBe(201);
    expect(prismaMock.prescription.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ supersedesPrescriptionId: previousPrescriptionId }),
    );
  });

  it("rejects invalid supersession and removes the uploaded object", async () => {
    prismaMock.prescription.findUnique.mockResolvedValue(null);
    const response = await uploadRequest().field("supersedesPrescriptionId", previousPrescriptionId);
    expectError(response, 409, "PRESCRIPTION_SUPERSESSION_NOT_ALLOWED");
    expect(storageMocks.delete).toHaveBeenCalledTimes(1);
  });

  it("keeps nested prescription history safe and deterministic", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ id: orderId });
    prismaMock.prescription.findMany.mockResolvedValue([prescription()]);
    const response = await request(app)
      .get(`/api/v1/orders/${orderId}/prescriptions`)
      .set("Authorization", authenticateAs());
    expect(response.status).toBe(200);
    const args = prismaMock.prescription.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ uploadedAt: "asc" }, { id: "asc" }]);
    expect(args.select).not.toHaveProperty("storagePath");
    expect(args.select).not.toHaveProperty("reviewerStaffId");
  });
});
