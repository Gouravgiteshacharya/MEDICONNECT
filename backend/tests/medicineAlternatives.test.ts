import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { app } from "../src/app.js";
import { buildExactCompositionWhere } from "../src/services/medicineAlternatives.service.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    medicine: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    pharmacyInventory: { findMany: vi.fn() },
    pharmacy: { findMany: vi.fn() },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");
const prismaMock = prisma as unknown as {
  medicine: { findFirst: Mock; findMany: Mock; count: Mock };
  pharmacyInventory: { findMany: Mock };
  pharmacy: { findMany: Mock };
};

const sourceId = "11111111-1111-4111-8111-111111111111";
const ingredientX = "22222222-2222-4222-8222-222222222222";
const ingredientY = "33333333-3333-4333-8333-333333333333";
const ingredientZ = "44444444-4444-4444-8444-444444444444";

function decimal(value: string) {
  return { toString: () => value };
}

function composition(activeIngredientId = ingredientX, strength = "500", strengthUnit = "mg") {
  return {
    activeIngredientId,
    strength: decimal(strength),
    strengthUnit,
    activeIngredient: { id: activeIngredientId, name: `Ingredient ${activeIngredientId.at(0)}` },
  };
}

function medicine(overrides: Record<string, unknown> = {}) {
  return {
    id: sourceId,
    name: "Source Medicine",
    brandName: "Source Brand",
    genericName: "Source Generic",
    manufacturer: "Source Labs",
    requiresPrescription: false,
    compositions: [composition()],
    ...overrides,
  };
}

function endpoint(query = "") {
  return `/api/v1/medicines/${sourceId}/alternatives${query ? `?${query}` : ""}`;
}

type Tuple = ReturnType<typeof composition>;

function predicateMatches(where: any, candidateId: string, active: boolean, tuples: Tuple[]) {
  if (!active || candidateId === sourceId) return false;
  return where.AND.every((clause: any) => {
    if (clause.compositions.some) {
      const expected = clause.compositions.some;
      return tuples.some((actual) =>
        actual.activeIngredientId === expected.activeIngredientId &&
        actual.strength.toString() === expected.strength.toString() &&
        actual.strengthUnit === expected.strengthUnit);
    }
    const allowed = clause.compositions.every.OR;
    return tuples.every((actual) => allowed.some((expected: any) =>
      actual.activeIngredientId === expected.activeIngredientId &&
      actual.strength.toString() === expected.strength.toString() &&
      actual.strengthUnit === expected.strengthUnit));
  });
}

describe("public composition-based medicine alternatives API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.medicine.findFirst.mockResolvedValue(medicine());
    prismaMock.medicine.findMany.mockResolvedValue([]);
    prismaMock.medicine.count.mockResolvedValue(0);
  });

  describe("validation and source eligibility", () => {
    it("rejects malformed medicineId", async () => {
      const response = await request(app).get("/api/v1/medicines/not-a-uuid/alternatives");
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.medicine.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      ["zero page", "page=0"], ["negative page", "page=-1"], ["fractional page", "page=1.5"],
      ["zero pageSize", "pageSize=0"], ["negative pageSize", "pageSize=-1"],
      ["fractional pageSize", "pageSize=1.5"], ["pageSize above 100", "pageSize=101"],
      ["unknown query field", "sort=name"], ["repeated page", "page=1&page=2"],
      ["repeated pageSize", "pageSize=10&pageSize=20"],
    ])("rejects %s", async (_label, query) => {
      const response = await request(app).get(endpoint(query));
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.medicine.findFirst).not.toHaveBeenCalled();
    });

    it.each(["nonexistent", "inactive"])("returns safe 404 for an %s source", async () => {
      prismaMock.medicine.findFirst.mockResolvedValue(null);
      const response = await request(app).get(endpoint());
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Medicine not found.", code: "MEDICINE_NOT_FOUND" });
      expect(prismaMock.medicine.findMany).not.toHaveBeenCalled();
    });

    it("requires an active source in the source query", async () => {
      await request(app).get(endpoint());
      expect(prismaMock.medicine.findFirst.mock.calls[0][0].where).toEqual({ id: sourceId, isActive: true });
    });

    it("returns empty results without candidate queries for a source with no compositions", async () => {
      prismaMock.medicine.findFirst.mockResolvedValue(medicine({ compositions: [] }));
      const response = await request(app).get(endpoint());
      expect(response.status).toBe(200);
      expect(response.body.compositionMatches).toEqual([]);
      expect(response.body.pagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
      expect(prismaMock.medicine.findMany).not.toHaveBeenCalled();
      expect(prismaMock.medicine.count).not.toHaveBeenCalled();
    });
  });

  describe("exact Prisma composition predicate semantics", () => {
    const whereFor = (...tuples: Tuple[]) => buildExactCompositionWhere(sourceId, tuples as any);

    it("includes an exact single-ingredient tuple", () => {
      const tuple = composition();
      expect(predicateMatches(whereFor(tuple), ingredientY, true, [tuple])).toBe(true);
    });

    it.each([
      ["different ingredient", [composition(ingredientY)]],
      ["different strength", [composition(ingredientX, "499")]],
      ["different unit", [composition(ingredientX, "500", "g")]],
      ["equivalent-looking unconverted unit", [composition(ingredientX, "0.5", "g")]],
      ["unit casing difference", [composition(ingredientX, "500", "MG")]],
    ])("rejects %s", (_label, candidateTuples) => {
      expect(predicateMatches(whereFor(composition()), ingredientY, true, candidateTuples as Tuple[])).toBe(false);
    });

    it("includes an exact multi-ingredient set regardless of row order", () => {
      const x = composition(); const y = composition(ingredientY, "30");
      expect(predicateMatches(whereFor(x, y), ingredientZ, true, [y, x])).toBe(true);
    });

    it.each([
      ["subset", [composition()]],
      ["superset", [composition(), composition(ingredientY, "30"), composition(ingredientZ, "10")]],
      ["partial overlap", [composition(), composition(ingredientZ, "30")]],
      ["one differing strength", [composition(), composition(ingredientY, "20")]],
      ["one differing unit", [composition(), composition(ingredientY, "30", "g")]],
    ])("rejects a multi-ingredient %s", (_label, candidateTuples) => {
      const source = [composition(), composition(ingredientY, "30")];
      expect(predicateMatches(whereFor(...source), ingredientZ, true, candidateTuples as Tuple[])).toBe(false);
    });

    it("handles a repeated ingredient at different strengths as distinct tuples", () => {
      const source = [composition(ingredientX, "500"), composition(ingredientX, "250")];
      expect(predicateMatches(whereFor(...source), ingredientY, true, source)).toBe(true);
      expect(predicateMatches(whereFor(...source), ingredientY, true, [source[0]])).toBe(false);
    });

    it("excludes inactive candidates", () => {
      const tuple = composition();
      expect(predicateMatches(whereFor(tuple), ingredientY, false, [tuple])).toBe(false);
    });

    it("excludes the source medicine", () => {
      const tuple = composition();
      expect(predicateMatches(whereFor(tuple), sourceId, true, [tuple])).toBe(false);
    });

    it("uses some for every source tuple and every to prohibit extras", () => {
      const where: any = whereFor(composition(), composition(ingredientY, "30"));
      expect(where.AND.slice(0, -1).every((clause: any) => clause.compositions.some)).toBe(true);
      expect(where.AND.at(-1).compositions.every.OR).toHaveLength(2);
    });

    it("passes Decimal objects directly into the database predicate without Number conversion", () => {
      const strength = decimal("500.125");
      const where: any = whereFor({ ...composition(), strength });
      expect(where.AND[0].compositions.some.strength).toBe(strength);
      expect(typeof where.AND[0].compositions.some.strength).toBe("object");
    });

    it("does not include requiresPrescription or catalogue text in equality", () => {
      const serialized = JSON.stringify(whereFor(composition()));
      for (const field of ["requiresPrescription", "name", "genericName", "brandName", "manufacturer"]) {
        expect(serialized).not.toContain(field);
      }
    });
  });

  describe("response, pagination, ordering, and query design", () => {
    it("is public and does not require authentication", async () => {
      expect((await request(app).get(endpoint())).status).toBe(200);
    });

    it("returns actual prescription flags even when source and match differ", async () => {
      prismaMock.medicine.findMany.mockResolvedValue([medicine({ id: ingredientY, requiresPrescription: true })]);
      const response = await request(app).get(endpoint());
      expect(response.body.medicine.requiresPrescription).toBe(false);
      expect(response.body.compositionMatches[0].requiresPrescription).toBe(true);
    });

    it("allows matching medicines with the same prescription flag", async () => {
      prismaMock.medicine.findMany.mockResolvedValue([medicine({ id: ingredientY })]);
      expect((await request(app).get(endpoint())).body.compositionMatches[0].requiresPrescription).toBe(false);
    });

    it("serializes Decimal strength deterministically with toString", async () => {
      const toString = vi.fn(() => "500.125");
      prismaMock.medicine.findFirst.mockResolvedValue(medicine({ compositions: [{ ...composition(), strength: { toString } }] }));
      const response = await request(app).get(endpoint());
      expect(response.body.medicine.compositions[0].strength).toBe("500.125");
      expect(toString).toHaveBeenCalled();
    });

    it("returns compositions in deterministic tuple order", async () => {
      prismaMock.medicine.findFirst.mockResolvedValue(medicine({ compositions: [composition(ingredientY), composition(ingredientX)] }));
      const response = await request(app).get(endpoint());
      expect(response.body.medicine.compositions.map((item: any) => item.activeIngredient.id)).toEqual([ingredientX, ingredientY]);
    });

    it("uses default pagination", async () => {
      const response = await request(app).get(endpoint());
      expect(response.body.pagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
      expect(prismaMock.medicine.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({ skip: 0, take: 20 }));
    });

    it("uses explicit pagination and correct skip/take", async () => {
      await request(app).get(endpoint("page=3&pageSize=10"));
      expect(prismaMock.medicine.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({ skip: 20, take: 10 }));
    });

    it("returns correct totals and totalPages", async () => {
      prismaMock.medicine.count.mockResolvedValue(21);
      const response = await request(app).get(endpoint("pageSize=10"));
      expect(response.body.pagination).toEqual({ page: 1, pageSize: 10, total: 21, totalPages: 3 });
    });

    it("returns an empty page beyond the final page with correct totals", async () => {
      prismaMock.medicine.count.mockResolvedValue(1);
      const response = await request(app).get(endpoint("page=3&pageSize=1"));
      expect(response.status).toBe(200);
      expect(response.body.compositionMatches).toEqual([]);
      expect(response.body.pagination).toEqual({ page: 3, pageSize: 1, total: 1, totalPages: 1 });
    });

    it("orders candidates by name then ID", async () => {
      await request(app).get(endpoint());
      expect(prismaMock.medicine.findMany.mock.calls[0][0].orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
    });

    it("performs one source, one candidate-list, and one count query", async () => {
      await request(app).get(endpoint());
      expect(prismaMock.medicine.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.medicine.findMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.medicine.count).toHaveBeenCalledTimes(1);
    });

    it("reuses the identical where object for list and count", async () => {
      await request(app).get(endpoint());
      expect(prismaMock.medicine.findMany.mock.calls[0][0].where).toBe(prismaMock.medicine.count.mock.calls[0][0].where);
    });

    it("uses explicit nested projections without composition row IDs or timestamps", async () => {
      await request(app).get(endpoint());
      for (const call of [prismaMock.medicine.findFirst, prismaMock.medicine.findMany]) {
        const select = call.mock.calls[0][0].select;
        expect(select.compositions.select).toEqual({
          activeIngredientId: true, strength: true, strengthUnit: true,
          activeIngredient: { select: { id: true, name: true } },
        });
        expect(select.createdAt).toBeUndefined();
        expect(select.updatedAt).toBeUndefined();
      }
    });

    it("does not perform per-candidate queries", async () => {
      prismaMock.medicine.findMany.mockResolvedValue([medicine({ id: ingredientY }), medicine({ id: ingredientZ })]);
      await request(app).get(endpoint());
      expect(prismaMock.medicine.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.medicine.findMany).toHaveBeenCalledTimes(1);
    });

    it("does not query inventory or pharmacy", async () => {
      await request(app).get(endpoint());
      expect(prismaMock.pharmacyInventory.findMany).not.toHaveBeenCalled();
      expect(prismaMock.pharmacy.findMany).not.toHaveBeenCalled();
    });

    it("exposes no composition IDs, timestamps, inventory, price, or location", async () => {
      prismaMock.medicine.findMany.mockResolvedValue([medicine({ id: ingredientY })]);
      const body = (await request(app).get(endpoint())).body;
      const serialized = JSON.stringify(body);
      for (const forbidden of ["compositionId", "createdAt", "updatedAt", "inventory", "price", "location", "pharmacy"]) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    it("uses the exact safe response vocabulary", async () => {
      const body = (await request(app).get(endpoint())).body;
      expect(body.matchBasis).toBe("EXACT_RECORDED_COMPOSITION");
      expect(body).toHaveProperty("compositionMatches");
      for (const unsafe of ["clinically equivalent", "safe substitute", "recommended replacement", "interchangeable"]) {
        expect(JSON.stringify(body).toLowerCase()).not.toContain(unsafe);
      }
    });

    it("contains no name or generic-name fallback behavior", async () => {
      const where = prismaMock.medicine.findMany.mock.calls;
      await request(app).get(endpoint());
      expect(JSON.stringify(prismaMock.medicine.findMany.mock.calls[0][0].where)).not.toContain("contains");
      expect(where).toBeDefined();
    });

    it("contains no AI, ML, scoring, or ranking behavior", async () => {
      await request(app).get(endpoint());
      const args = JSON.stringify(prismaMock.medicine.findMany.mock.calls[0][0]);
      for (const term of ["score", "rank", "similarity", "ai", "model"]) expect(args.toLowerCase()).not.toContain(term);
    });
  });
});
