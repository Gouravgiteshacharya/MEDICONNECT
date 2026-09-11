import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  InventoryManagementMode,
  InventoryStatus,
  PharmacyPartnerStatus,
  PharmacyStaffRole,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import {
  classifyInventoryFreshness,
  INVENTORY_FRESHNESS_THRESHOLD_MS,
} from "../src/utils/inventoryFreshness.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    pharmacyStaff: { findFirst: vi.fn() },
    pharmacy: { findUnique: vi.fn() },
    pharmacyInventory: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    medicine: { findMany: vi.fn() },
    order: { count: vi.fn(), findMany: vi.fn() },
    prescription: { count: vi.fn(), findMany: vi.fn() },
    deliveryAssignment: { count: vi.fn(), findMany: vi.fn() },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  pharmacyStaff: { findFirst: Mock };
  pharmacy: { findUnique: Mock };
  pharmacyInventory: { aggregate: Mock; groupBy: Mock; count: Mock; findMany: Mock };
  medicine: { findMany: Mock };
  order: { count: Mock; findMany: Mock };
  prescription: { count: Mock; findMany: Mock };
  deliveryAssignment: { count: Mock; findMany: Mock };
};

const userId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const otherPharmacyId = "33333333-3333-4333-8333-333333333333";
const path = `/api/v1/pharmacies/${pharmacyId}/dashboard`;

function token(role: UserRole = UserRole.PHARMACY_STAFF) {
  return signAuthToken({ userId, role });
}

function auth(role: UserRole = UserRole.PHARMACY_STAFF) {
  return { Authorization: `Bearer ${token(role)}` };
}

function mockUser(role: UserRole = UserRole.PHARMACY_STAFF) {
  prismaMock.user.findUnique.mockResolvedValue({ id: userId, role, isActive: true });
}

function mockMembership(
  role: PharmacyStaffRole = PharmacyStaffRole.OWNER,
  memberPharmacyId = pharmacyId,
) {
  prismaMock.pharmacyStaff.findFirst.mockImplementation(async ({ where }) =>
    where.userId === userId && where.pharmacyId === memberPharmacyId
      ? { id: "membership-internal", userId, pharmacyId: memberPharmacyId, role }
      : null,
  );
}

function pharmacy(overrides: Record<string, unknown> = {}) {
  return {
    id: pharmacyId,
    name: "Community Pharmacy",
    isVerified: false,
    isActive: true,
    partnerStatus: PharmacyPartnerStatus.PENDING,
    inventoryManagementMode: InventoryManagementMode.SELF_MANAGED,
    ...overrides,
  };
}

function inventoryCalls() {
  return [
    prismaMock.pharmacyInventory.aggregate,
    prismaMock.pharmacyInventory.groupBy,
    prismaMock.pharmacyInventory.count,
  ];
}

describe("pharmacy dashboard API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.pharmacy.findUnique.mockResolvedValue(pharmacy());
    prismaMock.pharmacyInventory.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { quantity: null },
    });
    prismaMock.pharmacyInventory.groupBy.mockResolvedValue([]);
    prismaMock.pharmacyInventory.count.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("validation and authorization", () => {
    it("rejects a malformed pharmacy UUID", async () => {
      const response = await request(app).get("/api/v1/pharmacies/not-a-uuid/dashboard");
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it("rejects unknown dashboard query parameters", async () => {
      const response = await request(app).get(`${path}?limit=10`);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated requests", async () => {
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTH_REQUIRED");
      expect(prismaMock.pharmacyStaff.findFirst).not.toHaveBeenCalled();
    });

    it.each([UserRole.CUSTOMER, UserRole.DELIVERY_PARTNER, UserRole.ADMIN])(
      "rejects global %s before membership resolution",
      async (role) => {
        mockUser(role);
        const response = await request(app).get(path).set(auth(role));
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("FORBIDDEN");
        expect(prismaMock.pharmacyStaff.findFirst).not.toHaveBeenCalled();
      },
    );

    it.each(Object.values(PharmacyStaffRole))(
      "allows an active %s membership",
      async (role) => {
        mockUser();
        mockMembership(role);
        expect((await request(app).get(path).set(auth())).status).toBe(200);
      },
    );

    it.each(["missing", "inactive"])("rejects %s membership", async () => {
      mockUser();
      prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);
      const response = await request(app).get(path).set(auth());
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: "You do not have permission to access this pharmacy.",
        code: "FORBIDDEN",
      });
      for (const operation of inventoryCalls()) expect(operation).not.toHaveBeenCalled();
    });

    it("rejects cross-pharmacy membership", async () => {
      mockUser();
      mockMembership(PharmacyStaffRole.OWNER, otherPharmacyId);
      expect((await request(app).get(path).set(auth())).status).toBe(403);
      expect(prismaMock.pharmacy.findUnique).not.toHaveBeenCalled();
    });

    it("resolves exact active user and pharmacy membership", async () => {
      mockUser();
      mockMembership();
      await request(app).get(path).set(auth());
      expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledWith({
        where: { userId, pharmacyId, isActive: true },
        select: { id: true, userId: true, pharmacyId: true, role: true },
      });
    });
  });

  describe("operational pharmacy metadata", () => {
    beforeEach(() => { mockUser(); mockMembership(); });

    it("selects the exact pharmacy without public eligibility predicates", async () => {
      await request(app).get(path).set(auth());
      expect(prismaMock.pharmacy.findUnique).toHaveBeenCalledWith({
        where: { id: pharmacyId },
        select: {
          id: true,
          name: true,
          isVerified: true,
          isActive: true,
          partnerStatus: true,
          inventoryManagementMode: true,
        },
      });
    });

    it.each([
      ["unverified", { isVerified: false }],
      ["inactive", { isActive: false }],
      ["PENDING", { partnerStatus: PharmacyPartnerStatus.PENDING }],
      ["SUSPENDED", { partnerStatus: PharmacyPartnerStatus.SUSPENDED }],
      ["OFFBOARDED", { partnerStatus: PharmacyPartnerStatus.OFFBOARDED }],
    ])("returns operational metadata for an authorized %s pharmacy", async (_label, state) => {
      prismaMock.pharmacy.findUnique.mockResolvedValue(pharmacy(state));
      const response = await request(app).get(path).set(auth());
      expect(response.status).toBe(200);
      expect(response.body.pharmacy).toEqual(expect.objectContaining(state));
    });

    it("returns safe 404 when membership is valid but pharmacy is missing", async () => {
      prismaMock.pharmacy.findUnique.mockResolvedValue(null);
      const response = await request(app).get(path).set(auth());
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Pharmacy not found.", code: "PHARMACY_NOT_FOUND" });
      for (const operation of inventoryCalls()) expect(operation).not.toHaveBeenCalled();
    });

    it("exposes only frozen pharmacy metadata", async () => {
      const response = await request(app).get(path).set(auth());
      expect(Object.keys(response.body.pharmacy)).toEqual([
        "id", "name", "isVerified", "isActive", "partnerStatus", "inventoryManagementMode",
      ]);
      for (const field of ["licenseNumber", "address", "phone", "email", "latitude", "longitude", "staff", "membership", "createdAt", "updatedAt"]) {
        expect(response.body.pharmacy[field]).toBeUndefined();
      }
    });
  });

  describe("inventory summary", () => {
    beforeEach(() => { mockUser(); mockMembership(); });

    it("returns deterministic zeros for empty inventory", async () => {
      const response = await request(app).get(path).set(auth());
      expect(response.body.inventorySummary).toEqual({
        totalRecords: 0,
        totalUnits: 0,
        byAvailability: { AVAILABLE: 0, LOW_STOCK: 0, OUT_OF_STOCK: 0, UNAVAILABLE: 0 },
        freshness: { fresh: 0, stale: 0 },
        prescriptionRequirement: { requiresPrescription: 0, doesNotRequirePrescription: 0 },
      });
    });

    it("returns total records and total recorded units", async () => {
      prismaMock.pharmacyInventory.aggregate.mockResolvedValue({ _count: { _all: 7 }, _sum: { quantity: 42 } });
      const summary = (await request(app).get(path).set(auth())).body.inventorySummary;
      expect(summary.totalRecords).toBe(7);
      expect(summary.totalUnits).toBe(42);
    });

    it("converts a null quantity sum to zero", async () => {
      expect((await request(app).get(path).set(auth())).body.inventorySummary.totalUnits).toBe(0);
    });

    it("maps stored availability groups and fills missing statuses with zero", async () => {
      prismaMock.pharmacyInventory.groupBy.mockResolvedValue([
        { availability: InventoryStatus.AVAILABLE, _count: { _all: 4 } },
        { availability: InventoryStatus.LOW_STOCK, _count: { _all: 3 } },
        { availability: InventoryStatus.OUT_OF_STOCK, _count: { _all: 2 } },
      ]);
      expect((await request(app).get(path).set(auth())).body.inventorySummary.byAvailability).toEqual({
        AVAILABLE: 4, LOW_STOCK: 3, OUT_OF_STOCK: 2, UNAVAILABLE: 0,
      });
    });

    it("counts UNAVAILABLE from its stored enum group", async () => {
      prismaMock.pharmacyInventory.groupBy.mockResolvedValue([
        { availability: InventoryStatus.UNAVAILABLE, _count: { _all: 5 } },
      ]);
      expect((await request(app).get(path).set(auth())).body.inventorySummary.byAvailability.UNAVAILABLE).toBe(5);
    });

    it("does not infer LOW_STOCK or OUT_OF_STOCK from quantity", async () => {
      await request(app).get(path).set(auth());
      const args = prismaMock.pharmacyInventory.groupBy.mock.calls[0][0];
      expect(args.by).toEqual(["availability"]);
      expect(JSON.stringify(args)).not.toContain("quantity");
    });

    it("uses one bounded aggregate and one availability groupBy", async () => {
      await request(app).get(path).set(auth());
      expect(prismaMock.pharmacyInventory.aggregate).toHaveBeenCalledTimes(1);
      expect(prismaMock.pharmacyInventory.aggregate).toHaveBeenCalledWith({
        where: { pharmacyId }, _count: { _all: true }, _sum: { quantity: true },
      });
      expect(prismaMock.pharmacyInventory.groupBy).toHaveBeenCalledTimes(1);
      expect(prismaMock.pharmacyInventory.groupBy).toHaveBeenCalledWith({
        by: ["availability"], where: { pharmacyId }, _count: { _all: true },
      });
    });
  });

  describe("freshness and prescription metadata", () => {
    beforeEach(() => {
      mockUser();
      mockMembership();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
    });

    it("uses one shared cutoff derived from the existing freshness threshold", async () => {
      await request(app).get(path).set(auth());
      const expected = new Date(Date.now() - INVENTORY_FRESHNESS_THRESHOLD_MS);
      const countWheres = prismaMock.pharmacyInventory.count.mock.calls.map((call) => call[0].where);
      expect(countWheres[0]).toEqual({ pharmacyId, lastUpdated: { gte: expected } });
      expect(countWheres[1]).toEqual({ pharmacyId, lastUpdated: { lt: expected } });
      expect(countWheres[0].lastUpdated.gte).toBe(countWheres[1].lastUpdated.lt);
    });

    it("matches shared freshness semantics at and beyond the 24-hour boundary", async () => {
      await request(app).get(path).set(auth());
      const cutoff = prismaMock.pharmacyInventory.count.mock.calls[0][0].where.lastUpdated.gte;
      const now = new Date();
      expect(classifyInventoryFreshness(cutoff, now)).toBe("FRESH");
      expect(classifyInventoryFreshness(new Date(cutoff.getTime() - 1), now)).toBe("STALE");
    });

    it("returns fresh and stale counts", async () => {
      prismaMock.pharmacyInventory.count
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      expect((await request(app).get(path).set(auth())).body.inventorySummary.freshness).toEqual({ fresh: 6, stale: 2 });
    });

    it("uses relation-filtered inventory-row counts for prescription requirements", async () => {
      prismaMock.pharmacyInventory.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(8);
      const response = await request(app).get(path).set(auth());
      expect(response.body.inventorySummary.prescriptionRequirement).toEqual({
        requiresPrescription: 3,
        doesNotRequirePrescription: 8,
      });
      expect(prismaMock.pharmacyInventory.count.mock.calls[2][0].where).toEqual({
        pharmacyId, medicine: { requiresPrescription: true },
      });
      expect(prismaMock.pharmacyInventory.count.mock.calls[3][0].where).toEqual({
        pharmacyId, medicine: { requiresPrescription: false },
      });
    });
  });

  describe("query design and domain boundaries", () => {
    beforeEach(() => { mockUser(); mockMembership(); });

    it("performs exactly one membership, one pharmacy, one aggregate, one groupBy, and four count operations", async () => {
      await request(app).get(path).set(auth());
      expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.pharmacy.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.pharmacyInventory.aggregate).toHaveBeenCalledTimes(1);
      expect(prismaMock.pharmacyInventory.groupBy).toHaveBeenCalledTimes(1);
      expect(prismaMock.pharmacyInventory.count).toHaveBeenCalledTimes(4);
    });

    it("starts inventory operations only after membership and pharmacy access are established", async () => {
      await request(app).get(path).set(auth());
      const membershipOrder = prismaMock.pharmacyStaff.findFirst.mock.invocationCallOrder[0];
      const pharmacyOrder = prismaMock.pharmacy.findUnique.mock.invocationCallOrder[0];
      for (const operation of inventoryCalls()) {
        expect(operation.mock.invocationCallOrder[0]).toBeGreaterThan(membershipOrder);
        expect(operation.mock.invocationCallOrder[0]).toBeGreaterThan(pharmacyOrder);
      }
    });

    it("scopes every inventory operation to the requested pharmacy", async () => {
      await request(app).get(path).set(auth());
      expect(prismaMock.pharmacyInventory.aggregate.mock.calls[0][0].where.pharmacyId).toBe(pharmacyId);
      expect(prismaMock.pharmacyInventory.groupBy.mock.calls[0][0].where.pharmacyId).toBe(pharmacyId);
      for (const call of prismaMock.pharmacyInventory.count.mock.calls) {
        expect(call[0].where.pharmacyId).toBe(pharmacyId);
      }
    });

    it("does not fetch inventory rows or perform per-item medicine queries", async () => {
      await request(app).get(path).set(auth());
      expect(prismaMock.pharmacyInventory.findMany).not.toHaveBeenCalled();
      expect(prismaMock.medicine.findMany).not.toHaveBeenCalled();
    });

    it("does not query Order, Prescription, or Delivery models", async () => {
      await request(app).get(path).set(auth());
      for (const domain of [prismaMock.order, prismaMock.prescription, prismaMock.deliveryAssignment]) {
        expect(domain.count).not.toHaveBeenCalled();
        expect(domain.findMany).not.toHaveBeenCalled();
      }
    });

    it("adds no extra dashboard sections, valuation, lists, customer data, updater identity, or intelligence output", async () => {
      const body = (await request(app).get(path).set(auth())).body;
      expect(Object.keys(body)).toEqual(["pharmacy", "inventorySummary"]);
      const serialized = JSON.stringify(body).toLowerCase();
      for (const term of ["revenue", "valuation", "recentlyupdated", "staleinventoryitems", "customer", "updatedby", "recommendation", "score", "forecast", "intelligence", "machinelearning"]) {
        expect(serialized).not.toContain(term);
      }
    });
  });
});
