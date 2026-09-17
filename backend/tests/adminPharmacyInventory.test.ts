import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Prisma, UserRole } from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";
import { INVENTORY_FRESHNESS_THRESHOLD_MS } from "../src/utils/inventoryFreshness.js";

vi.mock("../src/lib/prisma.js", () => ({ prisma: {
  user: { findUnique: vi.fn() }, pharmacyStaff: { findFirst: vi.fn() },
  pharmacy: { findMany: vi.fn(), findUnique: vi.fn() },
  pharmacyInventory: { findMany: vi.fn() },
} }));
const { prisma } = await import("../src/lib/prisma.js");
const db = prisma as unknown as {
  user: { findUnique: Mock }; pharmacyStaff: { findFirst: Mock };
  pharmacy: { findMany: Mock; findUnique: Mock }; pharmacyInventory: { findMany: Mock };
};
const userId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const medicineId = "44444444-4444-4444-8444-444444444444";
const inventoryId = "55555555-5555-4555-8555-555555555555";
const now = new Date("2026-09-01T12:00:00Z");
const pharmacy = {
  id: pharmacyId, name: "Pharmacy", city: "Bengaluru", state: "Karnataka",
  isActive: false, isVerified: false, partnerStatus: "PENDING",
  inventoryManagementMode: "SELF_MANAGED", createdAt: now, updatedAt: now,
};
const inventory = {
  id: inventoryId, quantity: 12, sellingPrice: new Prisma.Decimal("99999999.99"),
  availability: "AVAILABLE", lastUpdated: now, updatedAt: now,
  pharmacy: { id: pharmacyId, name: "Pharmacy" }, medicine: { id: medicineId, name: "Medicine" },
};
function get(path: string, role: UserRole = UserRole.ADMIN) {
  db.user.findUnique.mockResolvedValue({ id: userId, role, isActive: true });
  return request(app).get(`/api/v1/admin${path}`).set("Authorization", `Bearer ${signAuthToken({ userId, role })}`);
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("Admin pharmacy and inventory reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    db.pharmacy.findMany.mockResolvedValue([]);
    db.pharmacy.findUnique.mockResolvedValue(pharmacy);
    db.pharmacyInventory.findMany.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  describe.each(["/pharmacies", `/pharmacies/${pharmacyId}`, "/inventory"])("%s authorization", (path) => {
    it("requires authentication", async () => {
      const response = await request(app).get(`/api/v1/admin${path}`);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTH_REQUIRED");
    });
    it.each([UserRole.CUSTOMER, UserRole.PHARMACY_STAFF, UserRole.DELIVERY_PARTNER])("denies %s", async (role) => {
      const response = await get(path, role);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
      expect(db.pharmacy.findMany).not.toHaveBeenCalled();
      expect(db.pharmacy.findUnique).not.toHaveBeenCalled();
      expect(db.pharmacyInventory.findMany).not.toHaveBeenCalled();
    });
    it("allows ADMIN without membership", async () => {
      expect((await get(path)).status).toBe(200);
      expect(db.pharmacyStaff.findFirst).not.toHaveBeenCalled();
    });
  });

  it("lists pharmacies including inactive/unverified partners with explicit fields", async () => {
    db.pharmacy.findMany.mockResolvedValue([pharmacy]);
    const response = await get("/pharmacies");
    expect(response.body).toEqual({ pharmacies: [json(pharmacy)], nextCursor: null });
    const args = db.pharmacy.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({});
    expect(args.take).toBe(21);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(Object.keys(args.select).sort()).toEqual(Object.keys(pharmacy).sort());
  });

  it.each([
    ["isActive=false", { isActive: false }], ["isActive=true", { isActive: true }],
    ["isVerified=false", { isVerified: false }], ["isVerified=true", { isVerified: true }],
    ["partnerStatus=SUSPENDED", { partnerStatus: "SUSPENDED" }],
    ["inventoryManagementMode=MEDICONNECT_MANAGED", { inventoryManagementMode: "MEDICONNECT_MANAGED" }],
  ])("applies pharmacy filter %s", async (query, where) => {
    const response = await get(`/pharmacies?${query}`);
    expect(response.status).toBe(200);
    expect(db.pharmacy.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });

  it("combines pharmacy filters", async () => {
    await get("/pharmacies?isActive=false&isVerified=true&partnerStatus=ACTIVE&inventoryManagementMode=SELF_MANAGED");
    expect(db.pharmacy.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      isActive: false, isVerified: true, partnerStatus: "ACTIVE", inventoryManagementMode: "SELF_MANAGED",
    } }));
  });

  describe.each(["pharmacies", "inventory"])("%s pagination", (kind) => {
    it("bounds pages and provides deterministic continuation", async () => {
      const mock = kind === "pharmacies" ? db.pharmacy.findMany : db.pharmacyInventory.findMany;
      const row = kind === "pharmacies" ? pharmacy : inventory;
      mock.mockResolvedValueOnce([row, { ...row, id: otherId }]).mockResolvedValueOnce([{ ...row, id: otherId }]);
      const first = await get(`/${kind}?limit=1`);
      expect(first.status).toBe(200);
      expect(first.body[kind]).toHaveLength(1);
      expect(first.body.nextCursor).toBe(row.id);
      const second = await get(`/${kind}?limit=1&cursor=${row.id}`);
      expect(second.body[kind][0].id).toBe(otherId);
      expect(second.body.nextCursor).toBeNull();
      expect(mock).toHaveBeenLastCalledWith(expect.objectContaining({ take: 2, cursor: { id: row.id }, skip: 1,
        orderBy: [{ [kind === "pharmacies" ? "createdAt" : "lastUpdated"]: "desc" }, { id: "desc" }],
      }));
    });
    it("accepts maximum limit and empty page", async () => {
      const response = await get(`/${kind}?limit=50`);
      expect(response.body).toEqual({ [kind]: [], nextCursor: null });
      const mock = kind === "pharmacies" ? db.pharmacy.findMany : db.pharmacyInventory.findMany;
      expect(mock).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
    });
    it.each(["limit=0", "limit=51", "limit=1.5", "limit=abc", "cursor=bad", "unknown=true"])("rejects %s", async (query) => {
      const response = await get(`/${kind}?${query}`);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });
  });

  it.each(["isActive=0", "isVerified=yes", "partnerStatus=UNKNOWN", "inventoryManagementMode=UNKNOWN"])("rejects invalid pharmacy filter %s", async (query) => {
    expect((await get(`/pharmacies?${query}`)).status).toBe(400);
    expect(db.pharmacy.findMany).not.toHaveBeenCalled();
  });

  it("returns the operational pharmacy detail without user/auth relations", async () => {
    const detail = { ...pharmacy, description: null, phone: "9876543210", email: null, licenseNumber: "LICENSE",
      addressLine1: "Market Road", addressLine2: null, postalCode: "560001", latitude: 12.9, longitude: 77.5 };
    db.pharmacy.findUnique.mockResolvedValue(detail);
    const response = await get(`/pharmacies/${pharmacyId}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ pharmacy: json(detail) });
    const args = db.pharmacy.findUnique.mock.calls[0]![0];
    expect(args.where).toEqual({ id: pharmacyId });
    expect(Object.keys(args.select).sort()).toEqual(Object.keys(detail).sort());
  });
  it("handles missing pharmacies", async () => {
    db.pharmacy.findUnique.mockResolvedValue(null);
    const response = await get(`/pharmacies/${pharmacyId}`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("PHARMACY_NOT_FOUND");
  });
  it("rejects invalid pharmacy IDs", async () => {
    expect((await get("/pharmacies/bad")).status).toBe(400);
  });

  it("monitors multiple pharmacies with exact prices and safe projections", async () => {
    db.pharmacyInventory.findMany.mockResolvedValue([inventory, {
      ...inventory, id: otherId, sellingPrice: new Prisma.Decimal("0.10"), pharmacy: { id: otherId, name: "Second" },
    }]);
    const response = await get("/inventory");
    expect(response.status).toBe(200);
    expect(response.body.inventory.map((row: any) => row.pharmacy.id)).toEqual([pharmacyId, otherId]);
    expect(response.body.inventory.map((row: any) => row.sellingPrice)).toEqual(["99999999.99", "0.10"]);
    const args = db.pharmacyInventory.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({});
    expect(args.take).toBe(21);
    expect(args.select).toEqual({ id: true, quantity: true, sellingPrice: true, availability: true,
      lastUpdated: true, updatedAt: true, pharmacy: { select: { id: true, name: true } }, medicine: { select: { id: true, name: true } } });
  });
  it("scopes inventory by pharmacy, medicine and availability", async () => {
    await get(`/inventory?pharmacyId=${pharmacyId}&medicineId=${medicineId}&availability=LOW_STOCK`);
    expect(db.pharmacyInventory.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      pharmacyId, medicineId, availability: "LOW_STOCK",
    } }));
  });
  it.each(["pharmacyId=bad", "medicineId=bad", "availability=UNKNOWN", "freshness=UNKNOWN"])("rejects invalid inventory filter %s", async (query) => {
    const response = await get(`/inventory?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(db.pharmacyInventory.findMany).not.toHaveBeenCalled();
  });
  it.each([[-1, "FRESH"], [0, "FRESH"], [1, "STALE"]])("classifies the freshness boundary offset %s", async (offset, expected) => {
    db.pharmacyInventory.findMany.mockResolvedValue([{ ...inventory, lastUpdated: new Date(now.getTime() - INVENTORY_FRESHNESS_THRESHOLD_MS - offset) }]);
    const response = await get("/inventory");
    expect(response.body.inventory[0].freshness).toBe(expected);
  });
  it.each(["FRESH", "STALE"])("filters %s with the same boundary as serialization", async (freshness) => {
    const cutoff = new Date(now.getTime() - INVENTORY_FRESHNESS_THRESHOLD_MS);
    const rows = [inventory, { ...inventory, lastUpdated: cutoff }, { ...inventory, lastUpdated: new Date(cutoff.getTime() - 1) }];
    db.pharmacyInventory.findMany.mockImplementation(async ({ where }) => rows.filter((row) =>
      where.lastUpdated.gte ? row.lastUpdated >= where.lastUpdated.gte : row.lastUpdated < where.lastUpdated.lt,
    ));
    const response = await get(`/inventory?freshness=${freshness}`);
    expect(response.status).toBe(200);
    expect(response.body.inventory).toHaveLength(freshness === "FRESH" ? 2 : 1);
    expect(response.body.inventory.every((row: any) => row.freshness === freshness)).toBe(true);
    expect(db.pharmacyInventory.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      lastUpdated: freshness === "FRESH" ? { gte: cutoff } : { lt: cutoff },
    } }));
  });
});
