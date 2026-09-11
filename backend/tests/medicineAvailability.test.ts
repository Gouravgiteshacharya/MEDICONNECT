import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  InventoryStatus,
  PharmacyPartnerStatus,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { classifyInventoryFreshness } from "../src/utils/inventoryFreshness.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    medicine: { findFirst: vi.fn() },
    pharmacyInventory: { findMany: vi.fn() },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");

const prismaMock = prisma as unknown as {
  medicine: { findFirst: Mock };
  pharmacyInventory: { findMany: Mock };
};

const medicineId = "11111111-1111-4111-8111-111111111111";

const medicine = {
  id: medicineId,
  name: "Paracetamol 500",
  brandName: "Relief",
  genericName: "Paracetamol",
  manufacturer: "Local Labs",
  requiresPrescription: false,
};

function decimal(value = "49.50") {
  return { toFixed: () => value };
}

function candidate(overrides: Record<string, unknown> = {}) {
  const lastUpdated = new Date(Date.now() - 60 * 60 * 1_000);
  return {
    id: "inventory-must-not-leak",
    quantity: 12,
    sellingPrice: decimal(),
    availability: InventoryStatus.AVAILABLE,
    lastUpdated,
    updatedByUserId: "updater-must-not-leak",
    pharmacy: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Alpha Pharmacy",
      phone: "9876543210",
      addressLine1: "12 Market Road",
      addressLine2: null,
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      latitude: 0,
      longitude: 0.01,
      licenseNumber: "must-not-leak",
      staff: [{ id: "must-not-leak" }],
    },
    ...overrides,
  };
}

function endpoint(query = "latitude=0&longitude=0") {
  return `/api/v1/medicines/${medicineId}/availability?${query}`;
}

function candidateWhere() {
  return prismaMock.pharmacyInventory.findMany.mock.calls[0]?.[0].where;
}

describe("public medicine availability API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.medicine.findFirst.mockResolvedValue(medicine);
    prismaMock.pharmacyInventory.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("validation and medicine eligibility", () => {
    it("rejects malformed medicineId", async () => {
      const response = await request(app).get(
        "/api/v1/medicines/not-a-uuid/availability?latitude=0&longitude=0",
      );
      expect(response.status).toBe(400);
      expect(prismaMock.medicine.findFirst).not.toHaveBeenCalled();
    });

    it.each(["inactive", "nonexistent"])(
      "returns safe 404 for an %s medicine",
      async () => {
        prismaMock.medicine.findFirst.mockResolvedValue(null);
        const response = await request(app).get(endpoint());
        expect(response.status).toBe(404);
        expect(response.body).toEqual({
          error: "Medicine not found.",
          code: "MEDICINE_NOT_FOUND",
        });
        expect(prismaMock.pharmacyInventory.findMany).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["missing latitude", "longitude=0"],
      ["missing longitude", "latitude=0"],
      ["latitude below -90", "latitude=-90.1&longitude=0"],
      ["latitude above 90", "latitude=90.1&longitude=0"],
      ["longitude below -180", "latitude=0&longitude=-180.1"],
      ["longitude above 180", "latitude=0&longitude=180.1"],
      ["NaN latitude", "latitude=NaN&longitude=0"],
      ["NaN longitude", "latitude=0&longitude=NaN"],
      ["infinite latitude", "latitude=Infinity&longitude=0"],
      ["zero radius", "latitude=0&longitude=0&radiusKm=0"],
      ["negative radius", "latitude=0&longitude=0&radiusKm=-1"],
      ["radius above 50", "latitude=0&longitude=0&radiusKm=51"],
      ["non-numeric radius", "latitude=0&longitude=0&radiusKm=near"],
      ["zero page", "latitude=0&longitude=0&page=0"],
      ["fractional page", "latitude=0&longitude=0&page=1.5"],
      ["zero pageSize", "latitude=0&longitude=0&pageSize=0"],
      ["pageSize above 100", "latitude=0&longitude=0&pageSize=101"],
      ["unknown query field", "latitude=0&longitude=0&sort=price"],
      ["repeated latitude", "latitude=0&latitude=1&longitude=0"],
    ])("rejects %s", async (_label, query) => {
      const response = await request(app).get(endpoint(query));
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.medicine.findFirst).not.toHaveBeenCalled();
    });

    it("applies default radius and pagination", async () => {
      const response = await request(app).get(endpoint());
      expect(response.status).toBe(200);
      expect(response.body.search.radiusKm).toBe(5);
      expect(response.body.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe("eligibility predicates", () => {
    it("includes eligible pharmacies and all authoritative eligibility predicates", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([candidate()]);
      const response = await request(app).get(endpoint());
      expect(response.status).toBe(200);
      expect(response.body.availability).toHaveLength(1);
      expect(candidateWhere().pharmacy).toEqual(
        expect.objectContaining({
          isActive: true,
          isVerified: true,
          partnerStatus: PharmacyPartnerStatus.ACTIVE,
        }),
      );
    });

    it.each(["isActive", "isVerified", "partnerStatus"])(
      "excludes pharmacies failing %s through the database predicate",
      async (field) => {
        await request(app).get(endpoint());
        const expected = field === "partnerStatus" ? PharmacyPartnerStatus.ACTIVE : true;
        expect(candidateWhere().pharmacy[field]).toBe(expected);
      },
    );

    it.each(["latitude", "longitude"])(
      "excludes pharmacies without %s through the database predicate",
      async (field) => {
        await request(app).get(endpoint());
        expect(candidateWhere().pharmacy[field]).toEqual(
          expect.objectContaining({ not: null }),
        );
      },
    );

    it("scopes candidates to the selected medicine", async () => {
      await request(app).get(endpoint());
      expect(candidateWhere().medicineId).toBe(medicineId);
    });

    it("prevents cross-medicine leakage with an exact database predicate", async () => {
      await request(app).get(endpoint());
      expect(candidateWhere()).toEqual(expect.objectContaining({ medicineId }));
    });

    it.each([InventoryStatus.AVAILABLE, InventoryStatus.LOW_STOCK])(
      "includes discoverable %s status",
      async (availability) => {
        prismaMock.pharmacyInventory.findMany.mockResolvedValue([
          candidate({ availability }),
        ]);
        const response = await request(app).get(endpoint());
        expect(response.body.availability[0].availability).toBe(availability);
        expect(candidateWhere().availability.in).toContain(availability);
      },
    );

    it.each([InventoryStatus.OUT_OF_STOCK, InventoryStatus.UNAVAILABLE])(
      "excludes %s through the candidate predicate",
      async (availability) => {
        await request(app).get(endpoint());
        expect(candidateWhere().availability.in).not.toContain(availability);
      },
    );

    it("excludes zero quantity through the candidate predicate", async () => {
      await request(app).get(endpoint());
      expect(candidateWhere().quantity).toEqual({ gt: 0 });
    });

    it("exposes positive quantity exactly", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        candidate({ quantity: 7 }),
      ]);
      const response = await request(app).get(endpoint());
      expect(response.body.availability[0].quantity).toBe(7);
    });
  });

  describe("representation, freshness, and privacy", () => {
    it("serializes sellingPrice with two decimal places", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        candidate({ sellingPrice: decimal("49.50") }),
      ]);
      const response = await request(app).get(endpoint());
      expect(response.body.availability[0].sellingPrice).toBe("49.50");
    });

    it.each([
      ["FRESH", 23 * 60 * 60 * 1_000],
      ["STALE", 24 * 60 * 60 * 1_000 + 1],
    ])("returns %s freshness", async (freshness, ageMs) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        candidate({ lastUpdated: new Date(Date.now() - ageMs) }),
      ]);
      const response = await request(app).get(endpoint());
      expect(response.body.availability[0].freshness).toBe(freshness);
    });

    it("classifies exactly 24 hours as FRESH", () => {
      const now = new Date("2026-08-30T12:00:00.000Z");
      const lastUpdated = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
      expect(classifyInventoryFreshness(lastUpdated, now)).toBe("FRESH");
    });

    it("does not expose inventory, updater, license, staff, or membership internals", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([candidate()]);
      const response = await request(app).get(endpoint());
      const item = response.body.availability[0];
      expect(item.id).toBeUndefined();
      expect(item.updatedByUserId).toBeUndefined();
      expect(item.pharmacy.licenseNumber).toBeUndefined();
      expect(item.pharmacy.staff).toBeUndefined();
      expect(item.pharmacy.membership).toBeUndefined();
    });

    it("returns the medicine summary once at the root", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([candidate()]);
      const response = await request(app).get(endpoint());
      expect(response.body.medicine).toEqual(medicine);
      expect(response.body.availability[0].medicine).toBeUndefined();
    });

    it("represents normalized customer search coordinates consistently", async () => {
      const response = await request(app).get(
        endpoint("latitude=12.5&longitude=-45.25&radiusKm=10"),
      );
      expect(response.body.search).toEqual({
        latitude: 12.5,
        longitude: -45.25,
        radiusKm: 10,
      });
    });
  });

  describe("distance, ordering, pagination, and query design", () => {
    it("includes a candidate exactly at the radius boundary", async () => {
      const longitude = 5 / 111.1950802335329;
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        candidate({ pharmacy: { ...candidate().pharmacy, longitude } }),
      ]);
      const response = await request(app).get(endpoint("latitude=0&longitude=0&radiusKm=5"));
      expect(response.body.availability).toHaveLength(1);
    });

    it("excludes candidates outside the exact radius", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        candidate({ pharmacy: { ...candidate().pharmacy, longitude: 0.1 } }),
      ]);
      const response = await request(app).get(endpoint());
      expect(response.body.availability).toEqual([]);
    });

    it("returns distanceKm rounded to three decimals", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([candidate()]);
      const response = await request(app).get(endpoint());
      expect(response.body.availability[0].distanceKm).toBe(1.112);
    });

    it("orders by exact distance before rounded display distance", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        candidate({ pharmacy: { ...candidate().pharmacy, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", longitude: 0.02 } }),
        candidate({ pharmacy: { ...candidate().pharmacy, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", longitude: 0.01 } }),
      ]);
      const response = await request(app).get(endpoint());
      expect(response.body.availability.map((item: { pharmacy: { id: string } }) => item.pharmacy.id)).toEqual([
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ]);
    });

    it("uses pharmacy name as the first distance tie-break", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        candidate({ pharmacy: { ...candidate().pharmacy, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Zulu Pharmacy" } }),
        candidate({ pharmacy: { ...candidate().pharmacy, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Alpha Pharmacy" } }),
      ]);
      const response = await request(app).get(endpoint());
      expect(response.body.availability.map((item: { pharmacy: { name: string } }) => item.pharmacy.name)).toEqual([
        "Alpha Pharmacy",
        "Zulu Pharmacy",
      ]);
    });

    it("uses pharmacy ID as the final tie-break", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        candidate({ pharmacy: { ...candidate().pharmacy, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }),
        candidate({ pharmacy: { ...candidate().pharmacy, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }),
      ]);
      const response = await request(app).get(endpoint());
      expect(response.body.availability[0].pharmacy.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    });

    it("supports explicit pagination after distance ordering", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        candidate({ pharmacy: { ...candidate().pharmacy, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", longitude: 0.01 } }),
        candidate({ pharmacy: { ...candidate().pharmacy, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", longitude: 0.02 } }),
      ]);
      const response = await request(app).get(endpoint("latitude=0&longitude=0&page=2&pageSize=1"));
      expect(response.body.availability[0].pharmacy.id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      expect(response.body.pagination).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
    });

    it("calculates total after exact-radius filtering", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        candidate(),
        candidate({ pharmacy: { ...candidate().pharmacy, id: "33333333-3333-4333-8333-333333333333", longitude: 1 } }),
      ]);
      const response = await request(app).get(endpoint());
      expect(response.body.pagination.total).toBe(1);
      expect(response.body.pagination.totalPages).toBe(1);
    });

    it("returns an empty list for a page beyond the final page", async () => {
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([candidate()]);
      const response = await request(app).get(endpoint("latitude=0&longitude=0&page=3&pageSize=1"));
      expect(response.status).toBe(200);
      expect(response.body.availability).toEqual([]);
      expect(response.body.pagination.total).toBe(1);
    });

    it("returns 200 when no nearby results exist", async () => {
      const response = await request(app).get(endpoint());
      expect(response.status).toBe(200);
      expect(response.body.availability).toEqual([]);
    });

    it("performs one active-medicine lookup and one candidate query", async () => {
      await request(app).get(endpoint());
      expect(prismaMock.medicine.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.pharmacyInventory.findMany).toHaveBeenCalledTimes(1);
    });

    it("uses a nested explicit pharmacy projection without N+1 queries", async () => {
      await request(app).get(endpoint());
      const args = prismaMock.pharmacyInventory.findMany.mock.calls[0][0];
      expect(args.select.pharmacy.select).toEqual({
        id: true,
        name: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        latitude: true,
        longitude: true,
      });
      expect(args.select.id).toBeUndefined();
    });

    it("uses wrapped longitude predicates for antimeridian searches", async () => {
      await request(app).get(endpoint("latitude=0&longitude=179.9&radiusKm=50"));
      expect(candidateWhere().pharmacy.OR).toHaveLength(2);
    });

    it("omits unsafe longitude bounds at high latitudes", async () => {
      await request(app).get(endpoint("latitude=89.9&longitude=20&radiusKm=50"));
      expect(candidateWhere().pharmacy.longitude).toEqual({ not: null });
      expect(candidateWhere().pharmacy.OR).toBeUndefined();
    });
  });
});
