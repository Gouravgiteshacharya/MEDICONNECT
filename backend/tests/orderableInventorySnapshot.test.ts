import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  InventoryStatus,
  PharmacyPartnerStatus,
} from "../generated/prisma/client.js";
import { getOrderableInventorySnapshot } from "../src/services/inventory.service.js";
import { classifyInventoryFreshness } from "../src/utils/inventoryFreshness.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    pharmacyInventory: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    pharmacy: { findFirst: vi.fn() },
    medicine: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    pharmacyStaff: { findFirst: vi.fn() },
    cart: { findFirst: vi.fn() },
    order: { findFirst: vi.fn() },
    orderItem: { findFirst: vi.fn() },
    prescription: { findFirst: vi.fn() },
    deliveryAssignment: { findFirst: vi.fn() },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");
const prismaMock = prisma as unknown as Record<string, Record<string, Mock>>;

const pharmacyId = "11111111-1111-4111-8111-111111111111";
const medicineId = "22222222-2222-4222-8222-222222222222";
const lastUpdated = new Date("2026-08-30T11:00:00.000Z");

function price(value = "49.50") {
  return { toFixed: vi.fn(() => value) };
}

function eligibleRecord(overrides: Record<string, unknown> = {}) {
  return {
    pharmacyId,
    medicineId,
    quantity: 7,
    sellingPrice: price(),
    availability: InventoryStatus.AVAILABLE,
    lastUpdated,
    medicine: { requiresPrescription: false },
    ...overrides,
  };
}

function queryArgs() {
  return prismaMock.pharmacyInventory.findFirst.mock.calls[0][0];
}

describe("getOrderableInventorySnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.pharmacyInventory.findFirst.mockResolvedValue(eligibleRecord());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("successful snapshot", () => {
    it.each([InventoryStatus.AVAILABLE, InventoryStatus.LOW_STOCK])(
      "returns positive-quantity %s inventory",
      async (availability) => {
        prismaMock.pharmacyInventory.findFirst.mockResolvedValue(
          eligibleRecord({ availability }),
        );
        const snapshot = await getOrderableInventorySnapshot(pharmacyId, medicineId);
        expect(snapshot?.availability).toBe(availability);
        expect(snapshot?.quantity).toBe(7);
      },
    );

    it.each([true, false])(
      "returns requiresPrescription=%s catalogue metadata",
      async (requiresPrescription) => {
        prismaMock.pharmacyInventory.findFirst.mockResolvedValue(
          eligibleRecord({ medicine: { requiresPrescription } }),
        );
        expect((await getOrderableInventorySnapshot(pharmacyId, medicineId))?.requiresPrescription)
          .toBe(requiresPrescription);
      },
    );

    it("returns exactly the frozen fields and values", async () => {
      const snapshot = await getOrderableInventorySnapshot(pharmacyId, medicineId);
      expect(snapshot).toEqual({
        pharmacyId,
        medicineId,
        quantity: 7,
        sellingPrice: "49.50",
        availability: InventoryStatus.AVAILABLE,
        lastUpdated,
        freshness: "FRESH",
        requiresPrescription: false,
      });
      expect(Object.keys(snapshot ?? {})).toEqual([
        "pharmacyId", "medicineId", "quantity", "sellingPrice", "availability",
        "lastUpdated", "freshness", "requiresPrescription",
      ]);
    });

    it("formats Decimal price to exactly two places without Number conversion", async () => {
      const sellingPrice = price("12345678.90");
      prismaMock.pharmacyInventory.findFirst.mockResolvedValue(
        eligibleRecord({ sellingPrice }),
      );
      const snapshot = await getOrderableInventorySnapshot(pharmacyId, medicineId);
      expect(snapshot?.sellingPrice).toBe("12345678.90");
      expect(sellingPrice.toFixed).toHaveBeenCalledWith(2);
    });

    it("returns the same lastUpdated Date instance", async () => {
      expect((await getOrderableInventorySnapshot(pharmacyId, medicineId))?.lastUpdated)
        .toBe(lastUpdated);
    });
  });

  describe("uniform non-orderable absence", () => {
    it.each([
      "missing pharmacy",
      "inactive pharmacy",
      "unverified pharmacy",
      "PENDING pharmacy",
      "SUSPENDED pharmacy",
      "OFFBOARDED pharmacy",
      "missing medicine",
      "inactive medicine",
      "missing inventory",
      "zero quantity",
      "negative quantity",
      "OUT_OF_STOCK inventory",
      "UNAVAILABLE inventory",
    ])("returns null for %s", async () => {
      prismaMock.pharmacyInventory.findFirst.mockResolvedValue(null);
      await expect(getOrderableInventorySnapshot(pharmacyId, medicineId))
        .resolves.toBeNull();
    });

    it("propagates unexpected database failures", async () => {
      const failure = new Error("database unavailable");
      prismaMock.pharmacyInventory.findFirst.mockRejectedValue(failure);
      await expect(getOrderableInventorySnapshot(pharmacyId, medicineId))
        .rejects.toBe(failure);
    });
  });

  describe("freshness", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
    });

    it("classifies exactly 24 hours old as FRESH using shared semantics", async () => {
      const boundary = new Date(Date.now() - 24 * 60 * 60 * 1_000);
      prismaMock.pharmacyInventory.findFirst.mockResolvedValue(
        eligibleRecord({ lastUpdated: boundary }),
      );
      expect((await getOrderableInventorySnapshot(pharmacyId, medicineId))?.freshness)
        .toBe("FRESH");
      expect(classifyInventoryFreshness(boundary, new Date())).toBe("FRESH");
    });

    it("classifies 24 hours and one millisecond old as STALE using shared semantics", async () => {
      const stale = new Date(Date.now() - 24 * 60 * 60 * 1_000 - 1);
      prismaMock.pharmacyInventory.findFirst.mockResolvedValue(
        eligibleRecord({ lastUpdated: stale }),
      );
      expect((await getOrderableInventorySnapshot(pharmacyId, medicineId))?.freshness)
        .toBe("STALE");
      expect(classifyInventoryFreshness(stale, new Date())).toBe("STALE");
    });
  });

  describe("query contract and ownership boundaries", () => {
    it("performs exactly one bounded inventory lookup", async () => {
      await getOrderableInventorySnapshot(pharmacyId, medicineId);
      expect(prismaMock.pharmacyInventory.findFirst).toHaveBeenCalledTimes(1);
    });

    it("uses exact pharmacy, medicine, quantity, status, and public pharmacy eligibility", async () => {
      await getOrderableInventorySnapshot(pharmacyId, medicineId);
      expect(queryArgs().where).toEqual({
        pharmacyId,
        medicineId,
        quantity: { gt: 0 },
        availability: { in: [InventoryStatus.AVAILABLE, InventoryStatus.LOW_STOCK] },
        pharmacy: {
          isActive: true,
          isVerified: true,
          partnerStatus: PharmacyPartnerStatus.ACTIVE,
        },
        medicine: { isActive: true },
      });
    });

    it("uses only AVAILABLE and LOW_STOCK stored statuses", async () => {
      await getOrderableInventorySnapshot(pharmacyId, medicineId);
      expect(queryArgs().where.availability.in).toEqual([
        InventoryStatus.AVAILABLE,
        InventoryStatus.LOW_STOCK,
      ]);
      expect(queryArgs().where.availability.in).not.toContain(InventoryStatus.OUT_OF_STOCK);
      expect(queryArgs().where.availability.in).not.toContain(InventoryStatus.UNAVAILABLE);
    });

    it("uses the minimal explicit projection", async () => {
      await getOrderableInventorySnapshot(pharmacyId, medicineId);
      expect(queryArgs().select).toEqual({
        pharmacyId: true,
        medicineId: true,
        quantity: true,
        sellingPrice: true,
        availability: true,
        lastUpdated: true,
        medicine: { select: { requiresPrescription: true } },
      });
    });

    it("contains no geographic or radius logic", async () => {
      await getOrderableInventorySnapshot(pharmacyId, medicineId);
      const serialized = JSON.stringify(queryArgs());
      for (const field of ["latitude", "longitude", "radius", "distance"]) {
        expect(serialized).not.toContain(field);
      }
    });

    it("performs no inventory mutation", async () => {
      await getOrderableInventorySnapshot(pharmacyId, medicineId);
      for (const method of ["create", "update", "upsert", "delete"]) {
        expect(prismaMock.pharmacyInventory[method]).not.toHaveBeenCalled();
      }
    });

    it("performs no user, membership, pharmacy, or separate medicine query", async () => {
      await getOrderableInventorySnapshot(pharmacyId, medicineId);
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.pharmacyStaff.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.pharmacy.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.medicine.findFirst).not.toHaveBeenCalled();
    });

    it("performs no Cart, Order, OrderItem, Prescription, or Delivery query", async () => {
      await getOrderableInventorySnapshot(pharmacyId, medicineId);
      for (const model of ["cart", "order", "orderItem", "prescription", "deliveryAssignment"]) {
        expect(prismaMock[model].findFirst).not.toHaveBeenCalled();
      }
    });

    it("accepts no requested cart quantity or customer context", () => {
      expect(getOrderableInventorySnapshot.length).toBe(2);
    });
  });
});
