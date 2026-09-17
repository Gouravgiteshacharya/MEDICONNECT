import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FulfillmentMethod, OrderStatus, PharmacyStaffRole, Prisma, UserRole } from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    pharmacyStaff: { findFirst: vi.fn() },
    order: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
const { prisma } = await import("../src/lib/prisma.js");
const db = prisma as unknown as {
  user: { findUnique: Mock };
  pharmacyStaff: { findFirst: Mock };
  order: { findMany: Mock; findFirst: Mock };
};
const userId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const otherPharmacyId = "33333333-3333-4333-8333-333333333333";
const orderId = "44444444-4444-4444-8444-444444444444";
const secondId = "55555555-5555-4555-8555-555555555555";
const base = `/api/v1/pharmacies/${pharmacyId}/orders`;
const summary = {
  id: orderId, orderNumber: "MC-1", pharmacyId,
  status: OrderStatus.CONFIRMED, fulfillmentMethod: FulfillmentMethod.SELF_PICKUP,
  medicineSubtotal: new Prisma.Decimal("20.00"), deliveryFee: new Prisma.Decimal("0"),
  totalAmount: new Prisma.Decimal("20.00"), placedAt: new Date("2026-09-01T10:00:00Z"),
  confirmedAt: null, completedAt: null, cancelledAt: null,
};
function auth(role: UserRole = UserRole.PHARMACY_STAFF) {
  db.user.findUnique.mockResolvedValue({ id: userId, role, isActive: true });
  return `Bearer ${signAuthToken({ userId, role })}`;
}
function get(path = base) {
  return request(app).get(path).set("Authorization", auth());
}

describe("pharmacy order reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.pharmacyStaff.findFirst.mockResolvedValue({ id: "staff", userId, pharmacyId, role: PharmacyStaffRole.STAFF });
    db.order.findMany.mockResolvedValue([]);
    db.order.findFirst.mockResolvedValue(null);
  });

  describe.each(["list", "detail"])("%s authorization", (kind) => {
    const path = kind === "list" ? base : `${base}/${orderId}`;
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
      expect(db.order.findMany).not.toHaveBeenCalled();
      expect(db.order.findFirst).not.toHaveBeenCalled();
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
      expect(db.order.findMany).not.toHaveBeenCalled();
      expect(db.order.findFirst).not.toHaveBeenCalled();
    });
  });

  it("lists only the requested pharmacy with stable newest-first ordering", async () => {
    const rows = [
      { ...summary, _count: { items: 2 } },
      { ...summary, id: secondId, pharmacyId: otherPharmacyId, _count: { items: 1 } },
    ];
    db.order.findMany.mockImplementation(async ({ where }) => rows.filter((row) => row.pharmacyId === where.pharmacyId));
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.orders).toHaveLength(1);
    expect(response.body.orders[0]).toEqual({ ...JSON.parse(JSON.stringify(summary)), itemCount: 2 });
    expect(response.body.nextCursor).toBeNull();
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { pharmacyId }, take: 21, orderBy: [{ placedAt: "desc" }, { id: "desc" }] }));
    const select = db.order.findMany.mock.calls[0]![0].select;
    expect(Object.keys(select).sort()).toEqual([...Object.keys(summary), "_count"].sort());
  });

  it("paginates with a bounded limit and continuation cursor", async () => {
    db.order.findMany.mockResolvedValueOnce([
      { ...summary, _count: { items: 1 } },
      { ...summary, id: secondId, _count: { items: 1 } },
    ]).mockResolvedValueOnce([{ ...summary, id: secondId, _count: { items: 1 } }]);
    const first = await get(`${base}?limit=1`);
    expect(first.status).toBe(200);
    expect(first.body.orders).toHaveLength(1);
    expect(first.body.nextCursor).toBe(orderId);
    const second = await get(`${base}?limit=1&cursor=${first.body.nextCursor}`);
    expect(second.status).toBe(200);
    expect(second.body.orders[0].id).toBe(secondId);
    expect(second.body.nextCursor).toBeNull();
    expect(db.order.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { pharmacyId }, take: 2, cursor: { id: orderId }, skip: 1 }));
  });

  it("accepts the maximum page size", async () => {
    expect((await get(`${base}?limit=50`)).status).toBe(200);
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
  });

  it("returns an empty final page", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ orders: [], nextCursor: null });
  });

  it.each(Object.values(FulfillmentMethod))("filters by status and %s fulfillment", async (fulfillmentMethod) => {
    const rows = [
      { ...summary, fulfillmentMethod, _count: { items: 1 } },
      { ...summary, status: OrderStatus.CANCELLED, _count: { items: 1 } },
      { ...summary, fulfillmentMethod: "OTHER", _count: { items: 1 } },
    ];
    db.order.findMany.mockImplementation(async ({ where }) => rows.filter((row) => row.pharmacyId === where.pharmacyId && row.status === where.status && row.fulfillmentMethod === where.fulfillmentMethod));
    const response = await get(`${base}?status=CONFIRMED&fulfillmentMethod=${fulfillmentMethod}`);
    expect(response.status).toBe(200);
    expect(response.body.orders).toHaveLength(1);
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { pharmacyId, status: OrderStatus.CONFIRMED, fulfillmentMethod } }));
  });

  it.each(["limit=0", "limit=51", "limit=1.5", "limit=abc", "cursor=bad", "status=UNKNOWN", "fulfillmentMethod=UNKNOWN", "page=2", "pageSize=10", `pharmacyId=${otherPharmacyId}`])("rejects invalid query %s", async (query) => {
    const response = await get(`${base}?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(db.order.findMany).not.toHaveBeenCalled();
  });

  it.each([`/api/v1/pharmacies/bad/orders`, `${base}/bad`])("validates route UUIDs: %s", async (path) => {
    const response = await get(path);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(db.order.findFirst).not.toHaveBeenCalled();
  });

  it("returns operational detail using explicit safe selections", async () => {
    const detail = {
      ...summary, createdAt: summary.placedAt, updatedAt: summary.placedAt,
      items: [{ id: "item", medicineId: null, medicineNameSnapshot: "Medicine", brandNameSnapshot: null, manufacturerSnapshot: null, requiresPrescription: true, quantity: 2, unitPrice: new Prisma.Decimal(10), lineTotal: new Prisma.Decimal(20) }],
      prescriptions: [{ id: "prescription", status: "APPROVED", uploadedAt: summary.placedAt, reviewedAt: null, reviewNotes: null, rejectionReason: null, supersedesPrescriptionId: null }],
    };
    db.order.findFirst.mockResolvedValue(detail);
    const response = await get(`${base}/${orderId}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ order: JSON.parse(JSON.stringify(detail)) });
    const args = db.order.findFirst.mock.calls[0]![0];
    expect(args.where).toEqual({ id: orderId, pharmacyId });
    expect(Object.keys(args.select).sort()).toEqual(Object.keys(detail).sort());
    expect(Object.keys(args.select.items.select).sort()).toEqual(Object.keys(detail.items[0]!).sort());
    expect(Object.keys(args.select.prescriptions.select).sort()).toEqual(Object.keys(detail.prescriptions[0]!).sort());
    expect(args.select.items.orderBy).toEqual({ id: "asc" });
    expect(args.select.prescriptions.orderBy).toEqual([{ uploadedAt: "asc" }, { id: "asc" }]);
  });

  it.each(["cross-pharmacy", "nonexistent"])("returns ORDER_NOT_FOUND for %s orders", async (kind) => {
    const rows = kind === "cross-pharmacy" ? [{ ...summary, pharmacyId: otherPharmacyId }] : [];
    db.order.findFirst.mockImplementation(async ({ where }) => rows.find((row) => row.id === where.id && row.pharmacyId === where.pharmacyId) ?? null);
    const response = await get(`${base}/${orderId}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Order not found.", code: "ORDER_NOT_FOUND" });
  });
});
