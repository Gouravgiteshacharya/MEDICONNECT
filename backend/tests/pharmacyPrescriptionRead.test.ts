import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { OrderStatus, PharmacyStaffRole, PrescriptionStatus, UserRole } from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    pharmacyStaff: { findFirst: vi.fn() },
    prescription: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
const { prisma } = await import("../src/lib/prisma.js");
const db = prisma as unknown as {
  user: { findUnique: Mock };
  pharmacyStaff: { findFirst: Mock };
  prescription: { findMany: Mock; findFirst: Mock };
};
const userId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const otherPharmacyId = "33333333-3333-4333-8333-333333333333";
const prescriptionId = "44444444-4444-4444-8444-444444444444";
const secondId = "55555555-5555-4555-8555-555555555555";
const orderId = "66666666-6666-4666-8666-666666666666";
const base = `/api/v1/pharmacies/${pharmacyId}/prescriptions`;
const record = {
  id: prescriptionId, orderId, status: PrescriptionStatus.PENDING_REVIEW,
  uploadedAt: new Date("2026-09-01T10:00:00Z"), reviewedAt: null,
  reviewNotes: null, rejectionReason: null, supersedesPrescriptionId: null,
  supersededByPrescription: null,
  order: { id: orderId, orderNumber: "MC-1", status: OrderStatus.PRESCRIPTION_PENDING },
};
const expectedSelect = {
  id: true, orderId: true, status: true, uploadedAt: true, reviewedAt: true,
  reviewNotes: true, rejectionReason: true, supersedesPrescriptionId: true,
  supersededByPrescription: { select: { id: true } },
  order: { select: { id: true, orderNumber: true, status: true } },
};
function auth(role: UserRole = UserRole.PHARMACY_STAFF) {
  db.user.findUnique.mockResolvedValue({ id: userId, role, isActive: true });
  return `Bearer ${signAuthToken({ userId, role })}`;
}
function get(path = base) {
  return request(app).get(path).set("Authorization", auth());
}

describe("pharmacy prescription reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.pharmacyStaff.findFirst.mockResolvedValue({ id: "staff", userId, pharmacyId, role: PharmacyStaffRole.STAFF });
    db.prescription.findMany.mockResolvedValue([]);
    db.prescription.findFirst.mockResolvedValue(null);
  });

  describe.each(["list", "detail"])("%s authorization", (kind) => {
    const path = kind === "list" ? base : `${base}/${prescriptionId}`;
    it("requires authentication", async () => {
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTH_REQUIRED");
      expect(db.pharmacyStaff.findFirst).not.toHaveBeenCalled();
    });
    it.each([UserRole.CUSTOMER, UserRole.DELIVERY_PARTNER, UserRole.ADMIN])("denies %s", async (role) => {
      const response = await request(app).get(path).set("Authorization", auth(role));
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
      expect(db.pharmacyStaff.findFirst).not.toHaveBeenCalled();
      expect(db.prescription.findMany).not.toHaveBeenCalled();
      expect(db.prescription.findFirst).not.toHaveBeenCalled();
    });
    it.each(["inactive", "another pharmacy"])("denies %s membership", async (kind) => {
      const member = { userId, pharmacyId: kind === "inactive" ? pharmacyId : otherPharmacyId, isActive: kind !== "inactive" };
      db.pharmacyStaff.findFirst.mockImplementation(async ({ where }) =>
        member.userId === where.userId && member.pharmacyId === where.pharmacyId && member.isActive === where.isActive ? member : null,
      );
      const response = await get(path);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
      expect(db.pharmacyStaff.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId, pharmacyId, isActive: true } }));
      expect(db.prescription.findMany).not.toHaveBeenCalled();
      expect(db.prescription.findFirst).not.toHaveBeenCalled();
    });
  });

  it("lists only prescriptions whose order belongs to this pharmacy", async () => {
    const rows = [
      { pharmacyId, prescription: record },
      { pharmacyId: otherPharmacyId, prescription: { ...record, id: secondId } },
    ];
    db.prescription.findMany.mockImplementation(async ({ where }) => rows.filter((row) => row.pharmacyId === where.order.pharmacyId).map((row) => row.prescription));
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ prescriptions: [JSON.parse(JSON.stringify(record))], nextCursor: null });
    expect(db.prescription.findMany).toHaveBeenCalledWith({
      where: { order: { pharmacyId } }, select: expectedSelect,
      take: 21, orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    });
  });

  it("paginates with a bounded limit and continuation cursor", async () => {
    db.prescription.findMany.mockResolvedValueOnce([record, { ...record, id: secondId }])
      .mockResolvedValueOnce([{ ...record, id: secondId }]);
    const first = await get(`${base}?limit=1`);
    expect(first.status).toBe(200);
    expect(first.body.prescriptions).toHaveLength(1);
    expect(first.body.nextCursor).toBe(prescriptionId);
    const second = await get(`${base}?limit=1&cursor=${first.body.nextCursor}`);
    expect(second.status).toBe(200);
    expect(second.body.prescriptions[0].id).toBe(secondId);
    expect(second.body.nextCursor).toBeNull();
    expect(db.prescription.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { order: { pharmacyId } }, take: 2, cursor: { id: prescriptionId }, skip: 1,
    }));
  });

  it("accepts the maximum limit", async () => {
    expect((await get(`${base}?limit=50`)).status).toBe(200);
    expect(db.prescription.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
  });

  it("returns an empty final page", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ prescriptions: [], nextCursor: null });
  });

  it.each(Object.values(PrescriptionStatus))("filters by %s", async (status) => {
    const rows = Object.values(PrescriptionStatus).map((value) => ({ ...record, status: value }));
    db.prescription.findMany.mockImplementation(async ({ where }) => rows.filter((row) => row.status === where.status));
    const response = await get(`${base}?status=${status}`);
    expect(response.status).toBe(200);
    expect(response.body.prescriptions).toHaveLength(1);
    expect(response.body.prescriptions[0].status).toBe(status);
    expect(db.prescription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { order: { pharmacyId }, status } }));
  });

  it.each(["limit=0", "limit=51", "limit=1.5", "limit=abc", "cursor=bad", "status=UNKNOWN", "page=2", `pharmacyId=${otherPharmacyId}`, `orderId=${orderId}`])("rejects invalid query %s", async (query) => {
    const response = await get(`${base}?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(db.prescription.findMany).not.toHaveBeenCalled();
  });

  it.each(["/api/v1/pharmacies/bad/prescriptions", `${base}/bad`])("validates route UUIDs: %s", async (path) => {
    const response = await get(path);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(db.prescription.findFirst).not.toHaveBeenCalled();
  });

  it("returns scoped detail with review and supersession metadata only", async () => {
    const detail = {
      ...record, status: PrescriptionStatus.ADDITIONAL_INFO_REQUIRED,
      reviewNotes: "Please upload a clearer copy", reviewedAt: record.uploadedAt,
      supersedesPrescriptionId: secondId, supersededByPrescription: { id: "replacement" },
    };
    db.prescription.findFirst.mockResolvedValue(detail);
    const response = await get(`${base}/${prescriptionId}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ prescription: JSON.parse(JSON.stringify(detail)) });
    expect(db.prescription.findFirst).toHaveBeenCalledWith({
      where: { id: prescriptionId, order: { pharmacyId } }, select: expectedSelect,
    });
  });

  it.each(["cross-pharmacy", "nonexistent"])("returns non-leaking not-found for %s prescriptions", async (kind) => {
    const rows = kind === "cross-pharmacy" ? [{ pharmacyId: otherPharmacyId, prescription: record }] : [];
    db.prescription.findFirst.mockImplementation(async ({ where }) => rows.find((row) => row.prescription.id === where.id && row.pharmacyId === where.order.pharmacyId)?.prescription ?? null);
    const response = await get(`${base}/${prescriptionId}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Prescription not found.", code: "PRESCRIPTION_NOT_FOUND" });
  });
});
