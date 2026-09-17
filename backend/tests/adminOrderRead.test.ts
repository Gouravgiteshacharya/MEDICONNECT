import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Prisma, UserRole } from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({ prisma: {
  user: { findUnique: vi.fn() }, pharmacyStaff: { findFirst: vi.fn() },
  order: { findMany: vi.fn(), findUnique: vi.fn() },
} }));
const { prisma } = await import("../src/lib/prisma.js");
const db = prisma as unknown as {
  user: { findUnique: Mock }; pharmacyStaff: { findFirst: Mock };
  order: { findMany: Mock; findUnique: Mock };
};
const userId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const orderId = "44444444-4444-4444-8444-444444444444";
const secondId = "55555555-5555-4555-8555-555555555555";
const now = new Date("2026-09-01T12:00:00Z");
const summary = {
  id: orderId, orderNumber: "MC-1", pharmacyId, status: "CONFIRMED", fulfillmentMethod: "DELIVERY",
  medicineSubtotal: new Prisma.Decimal("99999999.99"), deliveryFee: new Prisma.Decimal("0.1"),
  totalAmount: new Prisma.Decimal("100000000.09"),
  placedAt: now, confirmedAt: now, completedAt: null, cancelledAt: null,
  pharmacy: { id: pharmacyId, name: "Pharmacy" },
};
const row = { ...summary, _count: { items: 1 } };
function get(path = "/orders", role: UserRole = UserRole.ADMIN) {
  db.user.findUnique.mockResolvedValue({ id: userId, role, isActive: true });
  return request(app).get(`/api/v1/admin${path}`).set("Authorization", `Bearer ${signAuthToken({ userId, role })}`);
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("Admin order reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.order.findMany.mockResolvedValue([]);
    db.order.findUnique.mockResolvedValue(summary);
  });
  describe.each(["/orders", `/orders/${orderId}`])("%s authorization", (path) => {
    it("requires authentication", async () => {
      const response = await request(app).get(`/api/v1/admin${path}`);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTH_REQUIRED");
    });
    it.each([UserRole.CUSTOMER, UserRole.PHARMACY_STAFF, UserRole.DELIVERY_PARTNER])("denies %s", async (role) => {
      const response = await get(path, role);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
      expect(db.order.findMany).not.toHaveBeenCalled();
      expect(db.order.findUnique).not.toHaveBeenCalled();
    });
    it("allows ADMIN without membership", async () => {
      expect((await get(path)).status).toBe(200);
      expect(db.pharmacyStaff.findFirst).not.toHaveBeenCalled();
    });
  });
  it("lists orders across pharmacies with exact Decimal strings", async () => {
    db.order.findMany.mockResolvedValue([row, { ...row, id: secondId, pharmacyId: otherId, pharmacy: { id: otherId, name: "Second" } }]);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.orders.map((o: { pharmacyId: string }) => o.pharmacyId)).toEqual([pharmacyId, otherId]);
    expect(response.body.orders[0]).toEqual({ ...json(summary), itemCount: 1 });
    expect(response.body.orders[0].totalAmount).toBe("100000000.09");
    expect(response.body.nextCursor).toBeNull();
    const args = db.order.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({});
    expect(args.take).toBe(21);
    expect(args.orderBy).toEqual([{ placedAt: "desc" }, { id: "desc" }]);
    expect(Object.keys(args.select).sort()).toEqual(Object.keys(row).sort());
    expect(args.select.pharmacy).toEqual({ select: { id: true, name: true } });
  });
  it.each([
    [`pharmacyId=${pharmacyId}`, { pharmacyId }],
    ["status=CONFIRMED", { status: "CONFIRMED" }],
    ["fulfillmentMethod=DELIVERY", { fulfillmentMethod: "DELIVERY" }],
    ["fulfillmentMethod=SELF_PICKUP", { fulfillmentMethod: "SELF_PICKUP" }],
  ])("applies filter %s", async (query, where) => {
    const rows = [row, { ...row, pharmacyId: otherId, status: "CANCELLED", fulfillmentMethod: "SELF_PICKUP" }];
    db.order.findMany.mockImplementation(async ({ where: filter }) => rows.filter((r) => Object.entries(filter).every(([key, value]) => r[key as keyof typeof r] === value)));
    const response = await get(`/orders?${query}`);
    expect(response.status).toBe(200);
    expect(response.body.orders).toHaveLength(1);
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });
  it.each([true, false])("filters prescription requirement %s by item snapshots", async (required) => {
    await get(`/orders?requiresPrescription=${required}`);
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      items: required ? { some: { requiresPrescription: true } } : { none: { requiresPrescription: true } },
    } }));
  });
  it("matches review status only on prescriptions not superseded, separately from requirement", async () => {
    const rows = [
      { result: row, prescriptions: [{ status: "APPROVED", supersededByPrescription: null }] },
      { result: { ...row, id: secondId }, prescriptions: [{ status: "APPROVED", supersededByPrescription: { id: "replacement" } }, { status: "PENDING_REVIEW", supersededByPrescription: null }] },
      { result: { ...row, id: otherId }, prescriptions: [] },
    ];
    db.order.findMany.mockImplementation(async ({ where }) => rows.filter((r) => r.prescriptions.some((p) => p.status === where.prescriptions.some.status && p.supersededByPrescription === where.prescriptions.some.supersededByPrescription)).map((r) => r.result));
    const response = await get("/orders?prescriptionStatus=APPROVED");
    expect(response.body.orders.map((o: { id: string }) => o.id)).toEqual([orderId]);
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      prescriptions: { some: { status: "APPROVED", supersededByPrescription: null } },
    } }));
  });
  it("combines operational filters", async () => {
    await get(`/orders?status=CONFIRMED&pharmacyId=${pharmacyId}&fulfillmentMethod=DELIVERY&requiresPrescription=true&prescriptionStatus=APPROVED`);
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      status: "CONFIRMED", pharmacyId, fulfillmentMethod: "DELIVERY",
      items: { some: { requiresPrescription: true } },
      prescriptions: { some: { status: "APPROVED", supersededByPrescription: null } },
    } }));
  });
  it("uses stable tie-breaking and cursor skipping without duplicates across pages", async () => {
    const rows = [row, { ...row, id: secondId }, { ...row, id: otherId }];
    db.order.findMany.mockImplementation(async ({ orderBy, cursor, skip = 0, take }) => {
      expect(orderBy).toEqual([{ placedAt: "desc" }, { id: "desc" }]);
      const sorted = [...rows].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime() || b.id.localeCompare(a.id));
      const start = cursor ? sorted.findIndex((r) => r.id === cursor.id) + skip : 0;
      return sorted.slice(start, start + take);
    });
    const first = await get("/orders?limit=2");
    expect(first.body.orders.map((o: { id: string }) => o.id)).toEqual([secondId, orderId]);
    expect(first.body.nextCursor).toBe(orderId);
    const second = await get(`/orders?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.orders.map((o: { id: string }) => o.id)).toEqual([otherId]);
    expect(second.body.nextCursor).toBeNull();
    expect(db.order.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: { id: orderId }, skip: 1, take: 3 }));
  });
  it("accepts maximum limit and empty results", async () => {
    expect((await get("/orders?limit=50")).body).toEqual({ orders: [], nextCursor: null });
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
  });
  it.each(["limit=0", "limit=51", "limit=1.5", "limit=abc", "cursor=bad", "pharmacyId=bad", "status=UNKNOWN", "fulfillmentMethod=UNKNOWN", "prescriptionStatus=UNKNOWN", "requiresPrescription=yes", "unknown=true"])("rejects %s", async (query) => {
    const response = await get(`/orders?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(db.order.findMany).not.toHaveBeenCalled();
  });
  it.each([pharmacyId, otherId])("returns safe operational detail from pharmacy %s", async (id) => {
    const detail = {
      ...summary, pharmacyId: id, pharmacy: { id, name: "Pharmacy" }, createdAt: now, updatedAt: now,
      customer: { id: userId, name: "Customer", email: "customer@example.test", phone: null },
      items: [{ id: "item", medicineId: null, medicineNameSnapshot: "Medicine", brandNameSnapshot: null, manufacturerSnapshot: null, requiresPrescription: true, quantity: 2, unitPrice: new Prisma.Decimal("0.10"), lineTotal: new Prisma.Decimal("0.20") }],
      prescriptions: [{ id: "prescription", status: "APPROVED", uploadedAt: now, reviewedAt: now, reviewNotes: null, rejectionReason: null, supersedesPrescriptionId: null, supersededByPrescription: null }],
    };
    db.order.findUnique.mockResolvedValue(detail);
    const response = await get(`/orders/${orderId}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ order: json(detail) });
    const args = db.order.findUnique.mock.calls[0]![0];
    expect(args.where).toEqual({ id: orderId });
    expect(Object.keys(args.select).sort()).toEqual(Object.keys(detail).sort());
    expect(Object.keys(args.select.items.select).sort()).toEqual(Object.keys(detail.items[0]!).sort());
    expect(Object.keys(args.select.prescriptions.select).sort()).toEqual(Object.keys(detail.prescriptions[0]!).sort());
    expect(args.select.customer).toEqual({ select: { id: true, name: true, email: true, phone: true } });
    expect(args.select.prescriptions.select.supersededByPrescription).toEqual({ select: { id: true } });
    expect(args.select.pharmacy).toEqual({ select: { id: true, name: true } });
    expect(args.select.items.orderBy).toEqual({ id: "asc" });
    expect(args.select.prescriptions.orderBy).toEqual([{ uploadedAt: "asc" }, { id: "asc" }]);
    expect(response.body.order.customer).not.toHaveProperty("passwordHash");
    expect(response.body.order.prescriptions[0]).not.toHaveProperty("fileUrl");
    expect(response.body.order.prescriptions[0]).not.toHaveProperty("storagePath");
    expect(response.body.order).not.toHaveProperty("deliveryAssignments");
  });
  it("handles missing orders", async () => {
    db.order.findUnique.mockResolvedValue(null);
    const response = await get(`/orders/${orderId}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Order not found.", code: "ORDER_NOT_FOUND" });
  });
  it("rejects invalid order UUID", async () => {
    expect((await get("/orders/bad")).status).toBe(400);
    expect(db.order.findUnique).not.toHaveBeenCalled();
  });
});
