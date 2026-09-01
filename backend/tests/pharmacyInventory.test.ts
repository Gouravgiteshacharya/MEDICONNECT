import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  InventoryStatus,
  PharmacyStaffRole,
  Prisma,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    pharmacyStaff: { findFirst: vi.fn() },
    medicine: { findFirst: vi.fn() },
    pharmacyInventory: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  pharmacyStaff: { findFirst: Mock };
  medicine: { findFirst: Mock };
  pharmacyInventory: {
    findMany: Mock;
    count: Mock;
    findFirst: Mock;
    create: Mock;
    update: Mock;
  };
};

const userId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const otherPharmacyId = "33333333-3333-4333-8333-333333333333";
const medicineId = "44444444-4444-4444-8444-444444444444";
const inventoryId = "55555555-5555-4555-8555-555555555555";

function price(value = "49.50") {
  return { toFixed: () => value };
}

function inventoryRecord(lastUpdated = new Date()) {
  return {
    id: inventoryId,
    quantity: 12,
    sellingPrice: price(),
    availability: InventoryStatus.AVAILABLE,
    lastUpdated,
    updatedAt: lastUpdated,
    medicine: {
      id: medicineId,
      name: "Paracetamol 500",
      brandName: "Relief",
      genericName: "Paracetamol",
      manufacturer: "Local Labs",
      requiresPrescription: false,
    },
  };
}

function token(role: UserRole = UserRole.PHARMACY_STAFF) {
  return signAuthToken({ userId, role });
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
      ? {
          id: "66666666-6666-4666-8666-666666666666",
          userId,
          pharmacyId: memberPharmacyId,
          role,
        }
      : null,
  );
}

function auth(role: UserRole = UserRole.PHARMACY_STAFF) {
  return { Authorization: `Bearer ${token(role)}` };
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    medicineId,
    quantity: 12,
    sellingPrice: "49.50",
    availability: InventoryStatus.AVAILABLE,
    ...overrides,
  };
}

function duplicateError() {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["pharmacyId", "medicineId"] },
  });
}

function notFoundError() {
  return new Prisma.PrismaClientKnownRequestError("missing", {
    code: "P2025",
    clientVersion: "test",
  });
}

describe("pharmacy inventory API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.pharmacyInventory.findMany.mockResolvedValue([]);
    prismaMock.pharmacyInventory.count.mockResolvedValue(0);
  });

  describe("GET /api/v1/pharmacies/:pharmacyId/inventory", () => {
    const path = `/api/v1/pharmacies/${pharmacyId}/inventory`;

    it("rejects unauthenticated requests", async () => {
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTH_REQUIRED");
    });

    it("rejects a globally unauthorized role before membership resolution", async () => {
      mockUser(UserRole.CUSTOMER);
      const response = await request(app).get(path).set(auth(UserRole.CUSTOMER));
      expect(response.status).toBe(403);
      expect(prismaMock.pharmacyStaff.findFirst).not.toHaveBeenCalled();
    });

    it("rejects staff from another pharmacy", async () => {
      mockUser();
      mockMembership(PharmacyStaffRole.OWNER, otherPharmacyId);
      const response = await request(app).get(path).set(auth());
      expect(response.status).toBe(403);
      expect(prismaMock.pharmacyInventory.findMany).not.toHaveBeenCalled();
    });

    it("rejects inactive membership", async () => {
      mockUser();
      prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);
      const response = await request(app).get(path).set(auth());
      expect(response.status).toBe(403);
      expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
    });

    it.each(Object.values(PharmacyStaffRole))(
      "allows active %s staff to read",
      async (role) => {
        mockUser();
        mockMembership(role);
        const response = await request(app).get(path).set(auth());
        expect(response.status).toBe(200);
      },
    );

    it("scopes list and count queries to the requested pharmacy", async () => {
      mockUser();
      mockMembership();
      await request(app).get(path).set(auth());
      expect(prismaMock.pharmacyInventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { pharmacyId } }),
      );
      expect(prismaMock.pharmacyInventory.count).toHaveBeenCalledWith({
        where: { pharmacyId },
      });
    });

    it.each(["name", "brandName", "genericName", "manufacturer"])(
      "q searches medicine %s",
      async (field) => {
        mockUser();
        mockMembership();
        await request(app).get(`${path}?q=%20Para%20`).set(auth());
        const where = prismaMock.pharmacyInventory.findMany.mock.calls[0][0].where;
        expect(where.medicine.OR).toContainEqual({
          [field]: { contains: "Para", mode: "insensitive" },
        });
      },
    );

    it("filters by availability", async () => {
      mockUser();
      mockMembership();
      await request(app)
        .get(`${path}?availability=LOW_STOCK`)
        .set(auth());
      expect(prismaMock.pharmacyInventory.findMany.mock.calls[0][0].where).toEqual({
        pharmacyId,
        availability: InventoryStatus.LOW_STOCK,
      });
    });

    it("uses pagination defaults and deterministic ordering", async () => {
      mockUser();
      mockMembership();
      const response = await request(app).get(path).set(auth());
      expect(prismaMock.pharmacyInventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: [{ medicine: { name: "asc" } }, { id: "asc" }],
        }),
      );
      expect(response.body.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
      });
    });

    it("supports explicit pagination", async () => {
      mockUser();
      mockMembership();
      prismaMock.pharmacyInventory.count.mockResolvedValue(35);
      const response = await request(app)
        .get(`${path}?page=2&pageSize=10`)
        .set(auth());
      expect(prismaMock.pharmacyInventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(response.body.pagination).toEqual({
        page: 2,
        pageSize: 10,
        total: 35,
        totalPages: 4,
      });
    });

    it.each(["?page=0", "?page=-1", "?page=1.5", "?pageSize=0", "?pageSize=101"])(
      "rejects invalid pagination %s",
      async (query) => {
        const response = await request(app).get(`${path}${query}`).set(auth());
        expect(response.status).toBe(400);
        expect(response.body.code).toBe("VALIDATION_ERROR");
      },
    );

    it("rejects unknown query parameters", async () => {
      const response = await request(app).get(`${path}?sort=price`).set(auth());
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });

    it("excludes unrelated fields and serializes sellingPrice", async () => {
      mockUser();
      mockMembership();
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        { ...inventoryRecord(), pharmacyId, updatedByUserId: userId, cartItems: [] },
      ]);
      prismaMock.pharmacyInventory.count.mockResolvedValue(1);
      const response = await request(app).get(path).set(auth());
      expect(response.body.inventory[0].sellingPrice).toBe("49.50");
      expect(response.body.inventory[0].pharmacyId).toBeUndefined();
      expect(response.body.inventory[0].updatedByUserId).toBeUndefined();
      expect(response.body.inventory[0].cartItems).toBeUndefined();
    });

    it.each([
      ["FRESH", 23],
      ["STALE", 25],
    ])("classifies inventory as %s", async (freshness, ageHours) => {
      mockUser();
      mockMembership();
      const lastUpdated = new Date(Date.now() - ageHours * 60 * 60 * 1_000);
      prismaMock.pharmacyInventory.findMany.mockResolvedValue([
        inventoryRecord(lastUpdated),
      ]);
      const response = await request(app).get(path).set(auth());
      expect(response.body.inventory[0].freshness).toBe(freshness);
    });
  });

  describe("GET /api/v1/pharmacies/:pharmacyId/inventory/:inventoryId", () => {
    const path = `/api/v1/pharmacies/${pharmacyId}/inventory/${inventoryId}`;

    it("allows an active member to read an item from their pharmacy", async () => {
      mockUser();
      mockMembership(PharmacyStaffRole.STAFF);
      prismaMock.pharmacyInventory.findFirst.mockResolvedValue(inventoryRecord());
      const response = await request(app).get(path).set(auth());
      expect(response.status).toBe(200);
      expect(prismaMock.pharmacyInventory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: inventoryId, pharmacyId } }),
      );
    });

    it.each(["another pharmacy's", "nonexistent"])(
      "returns safe 404 for %s item",
      async () => {
        mockUser();
        mockMembership();
        prismaMock.pharmacyInventory.findFirst.mockResolvedValue(null);
        const response = await request(app).get(path).set(auth());
        expect(response.status).toBe(404);
        expect(response.body).toEqual({
          error: "Inventory item not found.",
          code: "INVENTORY_NOT_FOUND",
        });
      },
    );

    it("rejects malformed inventoryId", async () => {
      const response = await request(app)
        .get(`/api/v1/pharmacies/${pharmacyId}/inventory/not-a-uuid`)
        .set(auth());
      expect(response.status).toBe(400);
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/v1/pharmacies/:pharmacyId/inventory", () => {
    const path = `/api/v1/pharmacies/${pharmacyId}/inventory`;

    async function post(body = createBody()) {
      return request(app).post(path).set(auth()).send(body);
    }

    it("rejects unauthenticated requests", async () => {
      const response = await request(app).post(path).send(createBody());
      expect(response.status).toBe(401);
    });

    it.each([PharmacyStaffRole.STAFF, PharmacyStaffRole.PHARMACIST])(
      "prevents %s from creating inventory",
      async (role) => {
        mockUser();
        mockMembership(role);
        const response = await post();
        expect(response.status).toBe(403);
        expect(prismaMock.pharmacyInventory.create).not.toHaveBeenCalled();
      },
    );

    it.each([PharmacyStaffRole.MANAGER, PharmacyStaffRole.OWNER])(
      "allows %s to create inventory",
      async (role) => {
        mockUser();
        mockMembership(role);
        prismaMock.medicine.findFirst.mockResolvedValue({ id: medicineId });
        prismaMock.pharmacyInventory.create.mockResolvedValue(inventoryRecord());
        const response = await post();
        expect(response.status).toBe(201);
      },
    );

    it.each(["cross-pharmacy", "inactive"])(
      "rejects %s membership",
      async (membershipCase) => {
        mockUser();
        if (membershipCase === "cross-pharmacy") {
          mockMembership(PharmacyStaffRole.OWNER, otherPharmacyId);
        } else {
          prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);
        }
        const response = await post();
        expect(response.status).toBe(403);
        expect(prismaMock.pharmacyInventory.create).not.toHaveBeenCalled();
      },
    );

    it.each(["inactive", "nonexistent"])(
      "rejects an %s medicine safely",
      async () => {
        mockUser();
        mockMembership();
        prismaMock.medicine.findFirst.mockResolvedValue(null);
        const response = await post();
        expect(response.status).toBe(404);
        expect(response.body.code).toBe("MEDICINE_NOT_FOUND");
        expect(prismaMock.medicine.findFirst).toHaveBeenCalledWith({
          where: { id: medicineId, isActive: true },
          select: { id: true },
        });
      },
    );

    it.each([
      ["negative quantity", { quantity: -1 }],
      ["non-integer quantity", { quantity: 1.5 }],
      ["zero price", { sellingPrice: "0" }],
      ["negative price", { sellingPrice: "-1.00" }],
      ["invalid availability", { availability: "IN_STOCK" }],
    ])("rejects %s", async (_label, overrides) => {
      const response = await post(createBody(overrides));
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.pharmacyInventory.create).not.toHaveBeenCalled();
    });

    it.each(["pharmacyId", "updatedByUserId", "lastUpdated"])(
      "rejects client-supplied %s",
      async (field) => {
        const response = await post(createBody({ [field]: "untrusted" }));
        expect(response.status).toBe(400);
        expect(prismaMock.pharmacyInventory.create).not.toHaveBeenCalled();
      },
    );

    it("uses route pharmacyId and authenticated userId in explicit create data", async () => {
      mockUser();
      mockMembership(PharmacyStaffRole.MANAGER);
      prismaMock.medicine.findFirst.mockResolvedValue({ id: medicineId });
      prismaMock.pharmacyInventory.create.mockResolvedValue(inventoryRecord());
      await post();
      const data = prismaMock.pharmacyInventory.create.mock.calls[0][0].data;
      expect(data).toEqual({
        pharmacyId,
        medicineId,
        quantity: 12,
        sellingPrice: "49.50",
        availability: InventoryStatus.AVAILABLE,
        updatedByUserId: userId,
        lastUpdated: expect.any(Date),
      });
    });

    it("returns a safe duplicate conflict without raw Prisma leakage", async () => {
      mockUser();
      mockMembership();
      prismaMock.medicine.findFirst.mockResolvedValue({ id: medicineId });
      prismaMock.pharmacyInventory.create.mockRejectedValue(duplicateError());
      const response = await post();
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "Inventory already exists for this medicine.",
        code: "INVENTORY_ALREADY_EXISTS",
      });
      expect(response.text).not.toContain("P2002");
    });
  });

  describe("PATCH /api/v1/pharmacies/:pharmacyId/inventory/:inventoryId", () => {
    const path = `/api/v1/pharmacies/${pharmacyId}/inventory/${inventoryId}`;

    async function patch(body: Record<string, unknown>) {
      return request(app).patch(path).set(auth()).send(body);
    }

    it("rejects unauthenticated requests", async () => {
      const response = await request(app).patch(path).send({ quantity: 3 });
      expect(response.status).toBe(401);
    });

    it.each([PharmacyStaffRole.STAFF, PharmacyStaffRole.PHARMACIST])(
      "prevents %s from updating inventory",
      async (role) => {
        mockUser();
        mockMembership(role);
        const response = await patch({ quantity: 3 });
        expect(response.status).toBe(403);
        expect(prismaMock.pharmacyInventory.update).not.toHaveBeenCalled();
      },
    );

    it.each([PharmacyStaffRole.MANAGER, PharmacyStaffRole.OWNER])(
      "allows %s to update inventory",
      async (role) => {
        mockUser();
        mockMembership(role);
        prismaMock.pharmacyInventory.findFirst.mockResolvedValue({ id: inventoryId });
        prismaMock.pharmacyInventory.update.mockResolvedValue(inventoryRecord());
        const response = await patch({ quantity: 3 });
        expect(response.status).toBe(200);
      },
    );

    it.each(["inactive", "cross-pharmacy"])(
      "rejects %s membership",
      async (membershipCase) => {
        mockUser();
        if (membershipCase === "cross-pharmacy") {
          mockMembership(PharmacyStaffRole.OWNER, otherPharmacyId);
        } else {
          prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);
        }
        const response = await patch({ quantity: 3 });
        expect(response.status).toBe(403);
        expect(prismaMock.pharmacyInventory.update).not.toHaveBeenCalled();
      },
    );

    it("does not expose an inventory item from another pharmacy", async () => {
      mockUser();
      mockMembership();
      prismaMock.pharmacyInventory.findFirst.mockResolvedValue(null);
      const response = await patch({ quantity: 3 });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("INVENTORY_NOT_FOUND");
      expect(prismaMock.pharmacyInventory.findFirst).toHaveBeenCalledWith({
        where: { id: inventoryId, pharmacyId },
        select: { id: true },
      });
    });

    it.each([
      ["unknown field", { note: "private" }],
      ["medicineId", { medicineId }],
      ["pharmacyId", { pharmacyId }],
      ["lastUpdated", { lastUpdated: new Date().toISOString() }],
      ["updatedByUserId", { updatedByUserId: userId }],
      ["empty body", {}],
      ["negative quantity", { quantity: -1 }],
      ["fractional quantity", { quantity: 1.5 }],
      ["zero price", { sellingPrice: "0.00" }],
      ["negative price", { sellingPrice: "-1.00" }],
      ["invalid availability", { availability: "IN_STOCK" }],
    ])("rejects %s", async (_label, body) => {
      const response = await patch(body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.pharmacyInventory.update).not.toHaveBeenCalled();
    });

    it("sets server-owned update fields and prevents mass assignment", async () => {
      mockUser();
      mockMembership(PharmacyStaffRole.OWNER);
      prismaMock.pharmacyInventory.findFirst.mockResolvedValue({ id: inventoryId });
      prismaMock.pharmacyInventory.update.mockResolvedValue(inventoryRecord());
      await patch({
        quantity: 5,
        sellingPrice: "55.25",
        availability: InventoryStatus.LOW_STOCK,
      });
      const args = prismaMock.pharmacyInventory.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: inventoryId });
      expect(args.data).toEqual({
        quantity: 5,
        sellingPrice: "55.25",
        availability: InventoryStatus.LOW_STOCK,
        updatedByUserId: userId,
        lastUpdated: expect.any(Date),
      });
      expect(args.data.medicineId).toBeUndefined();
      expect(args.data.pharmacyId).toBeUndefined();
    });

    it("translates a Prisma not-found race to safe 404", async () => {
      mockUser();
      mockMembership();
      prismaMock.pharmacyInventory.findFirst.mockResolvedValue({ id: inventoryId });
      prismaMock.pharmacyInventory.update.mockRejectedValue(notFoundError());
      const response = await patch({ quantity: 5 });
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: "Inventory item not found.",
        code: "INVENTORY_NOT_FOUND",
      });
      expect(response.text).not.toContain("P2025");
    });
  });
});
