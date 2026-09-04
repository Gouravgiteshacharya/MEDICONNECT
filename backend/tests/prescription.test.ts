import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  OrderStatus,
  Prisma,
  PrescriptionStatus,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import {
  createCustomerPrescription,
  MAX_PRESCRIPTION_UPLOAD_ATTEMPTS,
} from "../src/services/prescription.service.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    order: { findFirst: vi.fn() },
    prescription: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const { prisma } = await import("../src/lib/prisma.js");

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  order: { findFirst: Mock };
  prescription: { create: Mock; findMany: Mock };
  $transaction: Mock;
};

const customerId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const prescriptionId = "33333333-3333-4333-8333-333333333333";
const uploadedAt = new Date("2026-08-31T10:00:00.000Z");
const validInput = {
  fileUrl: "https://files.example.test/prescriptions/rx-1.pdf",
  storagePath: "customer/orders/rx-1.pdf",
  originalFilename: "prescription.pdf",
};

function authenticateAs(role: UserRole = UserRole.CUSTOMER) {
  prismaMock.user.findUnique.mockResolvedValueOnce({
    id: customerId,
    role,
    isActive: true,
  });
  return `Bearer ${signAuthToken({ userId: customerId, role })}`;
}

function uploadableOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    status: OrderStatus.PRESCRIPTION_PENDING,
    items: [{ id: "44444444-4444-4444-8444-444444444444" }],
    ...overrides,
  };
}

function prescription(overrides: Record<string, unknown> = {}) {
  return {
    id: prescriptionId,
    orderId,
    fileUrl: validInput.fileUrl,
    originalFilename: validInput.originalFilename,
    status: PrescriptionStatus.PENDING_REVIEW,
    uploadedAt,
    reviewedAt: null,
    reviewNotes: null,
    rejectionReason: null,
    ...overrides,
  };
}

function expectError(
  response: { status: number; body: unknown },
  status: number,
  code: string,
) {
  expect(response.status).toBe(status);
  expect(response.body).toEqual(expect.objectContaining({ code }));
}

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: "test",
  });
}

describe("customer prescription API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
  });

  describe("POST /api/v1/orders/:orderId/prescriptions", () => {
    it("rejects unauthenticated and non-customer requests", async () => {
      const unauthenticated = await request(app)
        .post(`/api/v1/orders/${orderId}/prescriptions`)
        .send(validInput);
      expect(unauthenticated.status).toBe(401);

      const forbidden = await request(app)
        .post(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF))
        .send(validInput);
      expect(forbidden.status).toBe(403);
      expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      ["invalid order id", "not-a-uuid", validInput],
      ["missing file URL", orderId, { originalFilename: "rx.pdf" }],
      ["empty file URL", orderId, { fileUrl: "" }],
      ["invalid file URL", orderId, { fileUrl: "not-a-url" }],
      ["unknown field", orderId, { ...validInput, status: "APPROVED" }],
      ["reviewer identity", orderId, { ...validInput, reviewerStaffId: customerId }],
      ["review timestamp", orderId, { ...validInput, reviewedAt: uploadedAt.toISOString() }],
      ["review notes", orderId, { ...validInput, reviewNotes: "approved" }],
      ["rejection reason", orderId, { ...validInput, rejectionReason: "invalid" }],
    ])("rejects %s through strict validation", async (_name, id, body) => {
      const response = await request(app)
        .post(`/api/v1/orders/${id}/prescriptions`)
        .set("Authorization", authenticateAs())
        .send(body);
      expectError(response, 400, "VALIDATION_ERROR");
      expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.prescription.create).not.toHaveBeenCalled();
    });

    it("does not leak an inaccessible order", async () => {
      prismaMock.order.findFirst.mockResolvedValue(null);
      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs())
        .send(validInput);
      expectError(response, 404, "ORDER_NOT_FOUND");
      expect(prismaMock.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: orderId, customerId } }),
      );
    });

    it("rejects an order that does not require a prescription", async () => {
      prismaMock.order.findFirst.mockResolvedValue(uploadableOrder({ items: [] }));
      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs())
        .send(validInput);
      expectError(response, 409, "PRESCRIPTION_NOT_REQUIRED");
      expect(prismaMock.prescription.create).not.toHaveBeenCalled();
    });

    it.each([
      OrderStatus.CREATED,
      OrderStatus.PRESCRIPTION_APPROVED,
      OrderStatus.PRESCRIPTION_REJECTED,
      OrderStatus.CONFIRMED,
      OrderStatus.CANCELLED,
    ])("rejects upload while the order is %s", async (status) => {
      prismaMock.order.findFirst.mockResolvedValue(uploadableOrder({ status }));
      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs())
        .send(validInput);
      expectError(response, 409, "PRESCRIPTION_UPLOAD_NOT_ALLOWED");
      expect(prismaMock.prescription.create).not.toHaveBeenCalled();
    });

    it("creates a pending-review record without customer-controlled review fields", async () => {
      prismaMock.order.findFirst.mockResolvedValue(uploadableOrder());
      prismaMock.prescription.create.mockResolvedValue(prescription());
      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs())
        .send(validInput);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        prescription: {
          ...prescription(),
          uploadedAt: uploadedAt.toISOString(),
        },
      });
      const createArgs = prismaMock.prescription.create.mock.calls[0][0];
      expect(createArgs.data).toEqual({ orderId, ...validInput });
      expect(createArgs.data).not.toHaveProperty("status");
      expect(createArgs.data).not.toHaveProperty("reviewerStaffId");
      expect(createArgs.data).not.toHaveProperty("reviewedAt");
      expect(createArgs.data).not.toHaveProperty("reviewNotes");
      expect(createArgs.data).not.toHaveProperty("rejectionReason");
      expect(createArgs.select).not.toHaveProperty("storagePath");
      expect(createArgs.select).not.toHaveProperty("reviewerStaffId");
      expect(response.body.prescription).not.toHaveProperty("storagePath");
      expect(response.body.prescription).not.toHaveProperty("reviewerStaffId");
      expect(prismaMock.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: "Serializable" },
      );
    });

    it("creates separate rows for multiple uploads and never mutates the order", async () => {
      prismaMock.order.findFirst.mockResolvedValue(uploadableOrder());
      prismaMock.prescription.create
        .mockResolvedValueOnce(prescription())
        .mockResolvedValueOnce(
          prescription({ id: "55555555-5555-4555-8555-555555555555" }),
        );

      const first = await request(app)
        .post(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs())
        .send(validInput);
      const second = await request(app)
        .post(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs())
        .send({ ...validInput, fileUrl: "https://files.example.test/rx-2.pdf" });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(prismaMock.prescription.create).toHaveBeenCalledTimes(2);
      expect(prismaMock.prescription.create.mock.calls[0][0].data).not.toHaveProperty("id");
      expect(prismaMock.prescription.create.mock.calls[1][0].data).not.toHaveProperty("id");
      expect(prismaMock.order).not.toHaveProperty("update");
    });

    it("retries P2034 and re-reads order eligibility", async () => {
      prismaMock.order.findFirst
        .mockRejectedValueOnce(knownError("P2034"))
        .mockResolvedValueOnce(uploadableOrder());
      prismaMock.prescription.create.mockResolvedValue(prescription());

      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs())
        .send(validInput);

      expect(response.status).toBe(201);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
      expect(prismaMock.order.findFirst).toHaveBeenCalledTimes(2);
      expect(prismaMock.prescription.create).toHaveBeenCalledTimes(1);
    });

    it("re-checks eligibility and stops if the order state changes on retry", async () => {
      prismaMock.order.findFirst
        .mockRejectedValueOnce(knownError("P2034"))
        .mockResolvedValueOnce(
          uploadableOrder({ status: OrderStatus.CONFIRMED }),
        );

      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs())
        .send(validInput);

      expectError(response, 409, "PRESCRIPTION_UPLOAD_NOT_ALLOWED");
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
      expect(prismaMock.order.findFirst).toHaveBeenCalledTimes(2);
      expect(prismaMock.prescription.create).not.toHaveBeenCalled();
    });

    it("returns upload conflict after exactly three P2034 failures", async () => {
      prismaMock.order.findFirst.mockRejectedValue(knownError("P2034"));

      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs())
        .send(validInput);

      expectError(response, 409, "PRESCRIPTION_UPLOAD_CONFLICT");
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(
        MAX_PRESCRIPTION_UPLOAD_ATTEMPTS,
      );
      expect(prismaMock.order.findFirst).toHaveBeenCalledTimes(
        MAX_PRESCRIPTION_UPLOAD_ATTEMPTS,
      );
      expect(prismaMock.prescription.create).not.toHaveBeenCalled();
    });

    it("does not retry unrelated errors", async () => {
      const failure = new Error("database unavailable");
      prismaMock.$transaction.mockRejectedValue(failure);

      await expect(
        createCustomerPrescription(customerId, orderId, validInput),
      ).rejects.toBe(failure);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("GET /api/v1/orders/:orderId/prescriptions", () => {
    it("rejects unauthenticated and non-customer requests", async () => {
      const unauthenticated = await request(app).get(
        `/api/v1/orders/${orderId}/prescriptions`,
      );
      expect(unauthenticated.status).toBe(401);

      const forbidden = await request(app)
        .get(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF));
      expect(forbidden.status).toBe(403);
      expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
    });

    it("rejects an invalid order UUID", async () => {
      const response = await request(app)
        .get("/api/v1/orders/not-a-uuid/prescriptions")
        .set("Authorization", authenticateAs());
      expectError(response, 400, "VALIDATION_ERROR");
    });

    it("does not leak an inaccessible order", async () => {
      prismaMock.order.findFirst.mockResolvedValue(null);
      const response = await request(app)
        .get(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs());
      expectError(response, 404, "ORDER_NOT_FOUND");
      expect(prismaMock.order.findFirst).toHaveBeenCalledWith({
        where: { id: orderId, customerId },
        select: { id: true },
      });
    });

    it("returns an empty history for an owned order", async () => {
      prismaMock.order.findFirst.mockResolvedValue({ id: orderId });
      prismaMock.prescription.findMany.mockResolvedValue([]);
      const response = await request(app)
        .get(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs());
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ prescriptions: [] });
    });

    it("returns all statuses in deterministic order without private fields", async () => {
      prismaMock.order.findFirst.mockResolvedValue({ id: orderId });
      const records = [
        prescription({ id: "10000000-0000-4000-8000-000000000001" }),
        prescription({ id: "10000000-0000-4000-8000-000000000002", status: PrescriptionStatus.APPROVED }),
        prescription({ id: "10000000-0000-4000-8000-000000000003", status: PrescriptionStatus.REJECTED }),
        prescription({ id: "10000000-0000-4000-8000-000000000004", status: PrescriptionStatus.ADDITIONAL_INFO_REQUIRED }),
      ];
      prismaMock.prescription.findMany.mockResolvedValue(records);
      const response = await request(app)
        .get(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs());

      expect(response.status).toBe(200);
      expect(response.body.prescriptions.map((item: { status: string }) => item.status)).toEqual([
        PrescriptionStatus.PENDING_REVIEW,
        PrescriptionStatus.APPROVED,
        PrescriptionStatus.REJECTED,
        PrescriptionStatus.ADDITIONAL_INFO_REQUIRED,
      ]);
      expect(prismaMock.prescription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId },
          orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
        }),
      );
      const select = prismaMock.prescription.findMany.mock.calls[0][0].select;
      expect(select).not.toHaveProperty("storagePath");
      expect(select).not.toHaveProperty("reviewerStaffId");
      for (const item of response.body.prescriptions) {
        expect(item).not.toHaveProperty("storagePath");
        expect(item).not.toHaveProperty("reviewerStaffId");
      }
    });

    it.each([
      OrderStatus.CREATED,
      OrderStatus.PRESCRIPTION_APPROVED,
      OrderStatus.PRESCRIPTION_REJECTED,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
    ])("continues to return history after order state %s", async (_status) => {
      prismaMock.order.findFirst.mockResolvedValue({ id: orderId });
      prismaMock.prescription.findMany.mockResolvedValue([prescription()]);
      const response = await request(app)
        .get(`/api/v1/orders/${orderId}/prescriptions`)
        .set("Authorization", authenticateAs());
      expect(response.status).toBe(200);
      expect(response.body.prescriptions).toHaveLength(1);
    });
  });
});
