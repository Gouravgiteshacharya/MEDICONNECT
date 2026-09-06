import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { app } from "../src/app.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    medicine: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");

const prismaMock = prisma as unknown as {
  medicine: {
    findMany: Mock;
    count: Mock;
    findFirst: Mock;
  };
};

const medicineId = "11111111-1111-4111-8111-111111111111";
const ingredientId = "22222222-2222-4222-8222-222222222222";

const listMedicine = {
  id: medicineId,
  name: "Paracetamol 500",
  brandName: "Relief",
  genericName: "Paracetamol",
  manufacturer: "Local Labs",
  description: "Catalogue description",
  requiresPrescription: false,
};

const detailMedicine = {
  ...listMedicine,
  compositions: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      strength: { toString: () => "500.000" },
      strengthUnit: "mg",
      activeIngredient: {
        id: ingredientId,
        name: "Paracetamol",
      },
    },
  ],
};

function lastFindManyArgs() {
  return prismaMock.medicine.findMany.mock.calls.at(-1)?.[0];
}

describe("medicine catalogue API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.medicine.findMany.mockResolvedValue([]);
    prismaMock.medicine.count.mockResolvedValue(0);
  });

  describe("GET /api/v1/medicines", () => {
    it("returns active medicines", async () => {
      prismaMock.medicine.findMany.mockResolvedValue([listMedicine]);
      prismaMock.medicine.count.mockResolvedValue(1);

      const response = await request(app).get("/api/v1/medicines");

      expect(response.status).toBe(200);
      expect(response.body.medicines).toEqual([listMedicine]);
    });

    it("excludes inactive medicines through query predicates", async () => {
      await request(app).get("/api/v1/medicines");

      expect(lastFindManyArgs().where).toEqual({ isActive: true });
      expect(prismaMock.medicine.count).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });

    it("supports trimmed case-insensitive q search", async () => {
      const response = await request(app).get("/api/v1/medicines?q=%20Para%20");

      expect(response.status).toBe(200);
      expect(lastFindManyArgs().where).toEqual({
        isActive: true,
        OR: expect.any(Array),
      });
      expect(lastFindManyArgs().where.OR).toHaveLength(4);
    });

    it("searches name", async () => {
      await request(app).get("/api/v1/medicines?q=Para");

      expect(lastFindManyArgs().where.OR).toContainEqual({
        name: { contains: "Para", mode: "insensitive" },
      });
    });

    it("searches brandName", async () => {
      await request(app).get("/api/v1/medicines?q=Para");

      expect(lastFindManyArgs().where.OR).toContainEqual({
        brandName: { contains: "Para", mode: "insensitive" },
      });
    });

    it("searches genericName", async () => {
      await request(app).get("/api/v1/medicines?q=Para");

      expect(lastFindManyArgs().where.OR).toContainEqual({
        genericName: { contains: "Para", mode: "insensitive" },
      });
    });

    it("searches manufacturer", async () => {
      await request(app).get("/api/v1/medicines?q=Para");

      expect(lastFindManyArgs().where.OR).toContainEqual({
        manufacturer: { contains: "Para", mode: "insensitive" },
      });
    });

    it("defaults pagination correctly", async () => {
      const response = await request(app).get("/api/v1/medicines");

      expect(response.status).toBe(200);
      expect(lastFindManyArgs()).toEqual(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
      );
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.pageSize).toBe(20);
    });

    it("supports explicit page and pageSize", async () => {
      const response = await request(app).get(
        "/api/v1/medicines?page=3&pageSize=10",
      );

      expect(response.status).toBe(200);
      expect(lastFindManyArgs()).toEqual(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(response.body.pagination).toEqual(
        expect.objectContaining({ page: 3, pageSize: 10 }),
      );
    });

    it.each([
      ["page = 0", "?page=0"],
      ["negative page", "?page=-1"],
      ["pageSize = 0", "?pageSize=0"],
      ["pageSize greater than 100", "?pageSize=101"],
      ["non-integer page", "?page=1.5"],
      ["non-integer pageSize", "?pageSize=2.5"],
    ])("rejects %s", async (_label, query) => {
      const response = await request(app).get(`/api/v1/medicines${query}`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.medicine.findMany).not.toHaveBeenCalled();
      expect(prismaMock.medicine.count).not.toHaveBeenCalled();
    });

    it("rejects unknown query parameters", async () => {
      const response = await request(app).get("/api/v1/medicines?sort=price");

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.medicine.findMany).not.toHaveBeenCalled();
    });

    it("returns pagination metadata correctly", async () => {
      prismaMock.medicine.count.mockResolvedValue(45);

      const response = await request(app).get(
        "/api/v1/medicines?page=2&pageSize=20",
      );

      expect(response.status).toBe(200);
      expect(response.body.pagination).toEqual({
        page: 2,
        pageSize: 20,
        total: 45,
        totalPages: 3,
      });
    });

    it("does not leak unrelated medicine fields", async () => {
      prismaMock.medicine.findMany.mockResolvedValue([
        {
          ...listMedicine,
          isActive: true,
          createdAt: new Date(),
          inventory: [{ quantity: 100 }],
          orderItems: [{ id: "private" }],
        },
      ]);
      prismaMock.medicine.count.mockResolvedValue(1);

      const response = await request(app).get("/api/v1/medicines");

      expect(response.status).toBe(200);
      expect(response.body.medicines).toEqual([listMedicine]);
      expect(response.body.medicines[0].inventory).toBeUndefined();
      expect(lastFindManyArgs().select).not.toHaveProperty("inventory");
    });

    it("normalizes a whitespace-only q to no search filter", async () => {
      const response = await request(app).get("/api/v1/medicines?q=%20%20%20");

      expect(response.status).toBe(200);
      expect(lastFindManyArgs().where).toEqual({ isActive: true });
    });
  });

  describe("GET /api/v1/medicines/:medicineId", () => {
    beforeEach(() => {
      prismaMock.medicine.findFirst.mockResolvedValue(detailMedicine);
    });

    it("returns an active medicine", async () => {
      const response = await request(app).get(`/api/v1/medicines/${medicineId}`);

      expect(response.status).toBe(200);
      expect(prismaMock.medicine.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: medicineId, isActive: true },
        }),
      );
      expect(response.body.medicine.id).toBe(medicineId);
    });

    it("returns composition entries", async () => {
      const response = await request(app).get(`/api/v1/medicines/${medicineId}`);

      expect(response.status).toBe(200);
      expect(response.body.medicine.compositions).toHaveLength(1);
    });

    it("exposes active ingredient id and name", async () => {
      const response = await request(app).get(`/api/v1/medicines/${medicineId}`);

      expect(response.body.medicine.compositions[0].activeIngredient).toEqual({
        id: ingredientId,
        name: "Paracetamol",
      });
    });

    it("exposes strength as a deterministic string and preserves strengthUnit", async () => {
      const response = await request(app).get(`/api/v1/medicines/${medicineId}`);

      expect(response.body.medicine.compositions[0]).toEqual(
        expect.objectContaining({
          strength: "500.000",
          strengthUnit: "mg",
        }),
      );
    });

    it("returns requiresPrescription", async () => {
      const response = await request(app).get(`/api/v1/medicines/${medicineId}`);

      expect(response.body.medicine.requiresPrescription).toBe(false);
    });

    it("returns a safe 404 for an inactive medicine", async () => {
      prismaMock.medicine.findFirst.mockResolvedValue(null);

      const response = await request(app).get(`/api/v1/medicines/${medicineId}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: "Medicine not found.",
        code: "MEDICINE_NOT_FOUND",
      });
      expect(prismaMock.medicine.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: medicineId, isActive: true },
        }),
      );
    });

    it("returns a safe 404 for a nonexistent medicine", async () => {
      prismaMock.medicine.findFirst.mockResolvedValue(null);

      const response = await request(app).get(`/api/v1/medicines/${medicineId}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe("MEDICINE_NOT_FOUND");
    });

    it("rejects a malformed medicine UUID", async () => {
      const response = await request(app).get("/api/v1/medicines/not-a-uuid");

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.medicine.findFirst).not.toHaveBeenCalled();
    });

    it("does not leak unrelated relation fields", async () => {
      prismaMock.medicine.findFirst.mockResolvedValue({
        ...detailMedicine,
        inventory: [{ quantity: 100 }],
        cartItems: [{ id: "private" }],
        compositions: [
          {
            ...detailMedicine.compositions[0],
            medicineId,
            activeIngredientId: ingredientId,
            activeIngredient: {
              ...detailMedicine.compositions[0].activeIngredient,
              description: "must-not-leak",
            },
          },
        ],
      });

      const response = await request(app).get(`/api/v1/medicines/${medicineId}`);

      expect(response.status).toBe(200);
      expect(response.body.medicine.inventory).toBeUndefined();
      expect(response.body.medicine.cartItems).toBeUndefined();
      expect(response.body.medicine.compositions[0].medicineId).toBeUndefined();
      expect(
        response.body.medicine.compositions[0].activeIngredient.description,
      ).toBeUndefined();
    });
  });
});
