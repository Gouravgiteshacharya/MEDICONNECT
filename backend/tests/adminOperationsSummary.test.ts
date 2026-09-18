import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { DeliveryAssignmentStatus, OrderStatus, PrescriptionStatus, UserRole } from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";
import { INVENTORY_FRESHNESS_THRESHOLD_MS } from "../src/utils/inventoryFreshness.js";
vi.mock("../src/lib/prisma.js", () => ({ prisma: {
  user: { findUnique: vi.fn() }, pharmacy: { count: vi.fn() }, order: { count: vi.fn() },
  prescription: { count: vi.fn() }, pharmacyInventory: { count: vi.fn() }, deliveryAssignment: { count: vi.fn() },
} }));
const { prisma } = await import("../src/lib/prisma.js");
const db = prisma as unknown as {
  user: { findUnique: Mock }; pharmacy: { count: Mock }; order: { count: Mock };
  prescription: { count: Mock }; pharmacyInventory: { count: Mock }; deliveryAssignment: { count: Mock };
};
const path = "/api/v1/admin/operations/summary";
const userId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-09-01T12:00:00Z");
const counts = [db.pharmacy.count, db.order.count, db.prescription.count, db.pharmacyInventory.count, db.deliveryAssignment.count];
function get(role: UserRole = UserRole.ADMIN) {
  db.user.findUnique.mockResolvedValue({ id: userId, role, isActive: true });
  return request(app).get(path).set("Authorization", `Bearer ${signAuthToken({ userId, role })}`);
}
describe("Admin operations summary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    counts.forEach((mock) => mock.mockResolvedValue(0));
  });
  afterEach(() => vi.useRealTimers());
  it("returns only numeric database counts to ADMIN", async () => {
    counts.forEach((mock, index) => mock.mockResolvedValue(index + 1));
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ summary: { activePharmacies: 1, openOrders: 2, pendingPrescriptionReviews: 3, staleInventory: 4, activeDeliveries: 5 } });
    counts.forEach((mock) => expect(mock).toHaveBeenCalledTimes(1));
  });
  it("returns real zero counts for empty data", async () => {
    expect((await get()).body).toEqual({ summary: { activePharmacies: 0, openOrders: 0, pendingPrescriptionReviews: 0, staleInventory: 0, activeDeliveries: 0 } });
  });
  it("requires authentication", async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(401);
    counts.forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });
  it.each([UserRole.CUSTOMER, UserRole.PHARMACY_STAFF, UserRole.DELIVERY_PARTNER])("denies %s", async (role) => {
    const response = await get(role);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN");
    counts.forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });
  it("counts only operationally eligible pharmacies", async () => {
    const rows = [
      { isActive: true, isVerified: true, partnerStatus: "ACTIVE" },
      { isActive: false, isVerified: true, partnerStatus: "ACTIVE" },
      { isActive: true, isVerified: false, partnerStatus: "ACTIVE" },
      ...["PENDING", "SUSPENDED", "OFFBOARDED"].map((partnerStatus) => ({ isActive: true, isVerified: true, partnerStatus })),
    ];
    db.pharmacy.count.mockImplementation(async ({ where }) => rows.filter((r) => r.isActive === where.isActive && r.isVerified === where.isVerified && r.partnerStatus === where.partnerStatus).length);
    expect((await get()).body.summary.activePharmacies).toBe(1);
    expect(db.pharmacy.count).toHaveBeenCalledWith({ where: { isActive: true, isVerified: true, partnerStatus: "ACTIVE" } });
  });
  it("includes every non-terminal order status and excludes every terminal state", async () => {
    const expectedOpen = ["CREATED", "PRESCRIPTION_PENDING", "PRESCRIPTION_APPROVED", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"];
    db.order.count.mockImplementation(async ({ where }) => {
      const included = Object.values(OrderStatus).filter((status) => !where.status.notIn.includes(status));
      expect(included.sort()).toEqual(expectedOpen.sort());
      return included.length;
    });
    expect((await get()).body.summary.openOrders).toBe(9);
  });
  it("counts only pending current prescriptions on orders awaiting review", async () => {
    const rows = [
      ...Object.values(PrescriptionStatus).map((status) => ({ status, supersededByPrescription: null, order: { status: "PRESCRIPTION_PENDING" } })),
      { status: "PENDING_REVIEW", supersededByPrescription: { id: "replacement" }, order: { status: "PRESCRIPTION_PENDING" } },
      { status: "PENDING_REVIEW", supersededByPrescription: null, order: { status: "CANCELLED" } },
    ];
    db.prescription.count.mockImplementation(async ({ where }) => rows.filter((r) => r.status === where.status && r.supersededByPrescription === where.supersededByPrescription && r.order.status === where.order.status).length);
    expect((await get()).body.summary.pendingPrescriptionReviews).toBe(1);
    expect(db.prescription.count).toHaveBeenCalledWith({ where: { status: "PENDING_REVIEW", supersededByPrescription: null, order: { status: "PRESCRIPTION_PENDING" } } });
  });
  it("uses a strict stale cutoff, excluding exactly 24 hours old", async () => {
    const cutoff = new Date(now.getTime() - INVENTORY_FRESHNESS_THRESHOLD_MS);
    const rows = [now, cutoff, new Date(cutoff.getTime() - 1)];
    db.pharmacyInventory.count.mockImplementation(async ({ where }) => rows.filter((date) => date < where.lastUpdated.lt).length);
    expect((await get()).body.summary.staleInventory).toBe(1);
    expect(db.pharmacyInventory.count).toHaveBeenCalledWith({ where: { lastUpdated: { lt: cutoff } } });
  });
  it("counts live delivery assignments, excluding terminal states", async () => {
    db.deliveryAssignment.count.mockImplementation(async ({ where }) => {
      expect(where.status.in).toEqual(["OFFERED", "ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"]);
      return Object.values(DeliveryAssignmentStatus).filter((status) => where.status.in.includes(status)).length;
    });
    expect((await get()).body.summary.activeDeliveries).toBe(4);
  });
});
