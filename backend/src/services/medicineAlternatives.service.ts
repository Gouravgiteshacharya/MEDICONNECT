import type { Prisma } from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import type { MedicineAlternativesQuery } from "../validators/medicineAlternatives.schemas.js";

type StrengthValue = Prisma.Decimal;

export type CompositionTuple = {
  activeIngredientId: string;
  strength: StrengthValue;
  strengthUnit: string;
};

type MedicineRecord = {
  id: string;
  name: string;
  brandName: string | null;
  genericName: string | null;
  manufacturer: string | null;
  requiresPrescription: boolean;
  compositions: Array<CompositionTuple & {
    activeIngredient: { id: string; name: string };
  }>;
};

const compositionSelect = {
  activeIngredientId: true,
  strength: true,
  strengthUnit: true,
  activeIngredient: { select: { id: true, name: true } },
} as const;

const publicMedicineWithCompositionsSelect = {
  id: true,
  name: true,
  brandName: true,
  genericName: true,
  manufacturer: true,
  requiresPrescription: true,
  compositions: { select: compositionSelect },
} as const;

export function buildExactCompositionWhere(
  sourceId: string,
  tuples: CompositionTuple[],
): Prisma.MedicineWhereInput {
  const exactTuples = tuples.map((tuple) => ({
    activeIngredientId: tuple.activeIngredientId,
    strength: tuple.strength,
    strengthUnit: tuple.strengthUnit,
  }));

  return {
    isActive: true,
    id: { not: sourceId },
    AND: [
      ...exactTuples.map((tuple) => ({ compositions: { some: tuple } })),
      { compositions: { every: { OR: exactTuples } } },
    ],
  };
}

function compareCompositions(
  left: MedicineRecord["compositions"][number],
  right: MedicineRecord["compositions"][number],
) {
  if (left.activeIngredientId !== right.activeIngredientId) {
    return left.activeIngredientId < right.activeIngredientId ? -1 : 1;
  }
  const strengthComparison = left.strength.toString().localeCompare(right.strength.toString());
  if (strengthComparison !== 0) return strengthComparison;
  return left.strengthUnit.localeCompare(right.strengthUnit);
}

function toPublicMedicine(medicine: MedicineRecord) {
  return {
    id: medicine.id,
    name: medicine.name,
    brandName: medicine.brandName,
    genericName: medicine.genericName,
    manufacturer: medicine.manufacturer,
    requiresPrescription: medicine.requiresPrescription,
    compositions: [...medicine.compositions].sort(compareCompositions).map((composition) => ({
      activeIngredient: {
        id: composition.activeIngredient.id,
        name: composition.activeIngredient.name,
      },
      strength: composition.strength.toString(),
      strengthUnit: composition.strengthUnit,
    })),
  };
}

export async function getCompositionBasedAlternatives(
  medicineId: string,
  input: MedicineAlternativesQuery,
) {
  const source = await prisma.medicine.findFirst({
    where: { id: medicineId, isActive: true },
    select: publicMedicineWithCompositionsSelect,
  });

  if (!source) {
    throw new ApiError(404, "Medicine not found.", "MEDICINE_NOT_FOUND");
  }

  if (source.compositions.length === 0) {
    return {
      medicine: toPublicMedicine(source),
      compositionMatches: [],
      matchBasis: "EXACT_RECORDED_COMPOSITION" as const,
      pagination: { page: input.page, pageSize: input.pageSize, total: 0, totalPages: 0 },
    };
  }

  const where = buildExactCompositionWhere(medicineId, source.compositions);
  const [matches, total] = await Promise.all([
    prisma.medicine.findMany({
      where,
      select: publicMedicineWithCompositionsSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.medicine.count({ where }),
  ]);

  return {
    medicine: toPublicMedicine(source),
    compositionMatches: matches.map(toPublicMedicine),
    matchBasis: "EXACT_RECORDED_COMPOSITION" as const,
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}
