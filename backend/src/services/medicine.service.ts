import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import type { MedicineListQuery } from "../validators/medicine.schemas.js";

type MedicineListRecord = {
  id: string;
  name: string;
  brandName: string | null;
  genericName: string | null;
  manufacturer: string | null;
  description: string | null;
  requiresPrescription: boolean;
};

type StrengthValue = {
  toString(): string;
};

type MedicineDetailRecord = MedicineListRecord & {
  compositions: Array<{
    id: string;
    strength: StrengthValue;
    strengthUnit: string;
    activeIngredient: {
      id: string;
      name: string;
    };
  }>;
};

export type MedicineListItem = MedicineListRecord;

export type MedicineDetail = MedicineListRecord & {
  compositions: Array<{
    activeIngredient: {
      id: string;
      name: string;
    };
    strength: string;
    strengthUnit: string;
  }>;
};

const medicineListSelect = {
  id: true,
  name: true,
  brandName: true,
  genericName: true,
  manufacturer: true,
  description: true,
  requiresPrescription: true,
} as const;

const medicineDetailSelect = {
  ...medicineListSelect,
  compositions: {
    orderBy: { id: "asc" as const },
    select: {
      id: true,
      strength: true,
      strengthUnit: true,
      activeIngredient: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} as const;

function toMedicineListItem(medicine: MedicineListRecord): MedicineListItem {
  return {
    id: medicine.id,
    name: medicine.name,
    brandName: medicine.brandName,
    genericName: medicine.genericName,
    manufacturer: medicine.manufacturer,
    description: medicine.description,
    requiresPrescription: medicine.requiresPrescription,
  };
}

function toMedicineDetail(medicine: MedicineDetailRecord): MedicineDetail {
  return {
    ...toMedicineListItem(medicine),
    compositions: medicine.compositions.map((composition) => ({
      activeIngredient: {
        id: composition.activeIngredient.id,
        name: composition.activeIngredient.name,
      },
      strength: composition.strength.toString(),
      strengthUnit: composition.strengthUnit,
    })),
  };
}

export async function listMedicines(input: MedicineListQuery) {
  const where = {
    isActive: true,
    ...(input.q
      ? {
          OR: [
            { name: { contains: input.q, mode: "insensitive" as const } },
            { brandName: { contains: input.q, mode: "insensitive" as const } },
            { genericName: { contains: input.q, mode: "insensitive" as const } },
            {
              manufacturer: {
                contains: input.q,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };

  const [records, total] = await Promise.all([
    prisma.medicine.findMany({
      where,
      select: medicineListSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.medicine.count({ where }),
  ]);

  return {
    medicines: records.map(toMedicineListItem),
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function getMedicineDetail(
  medicineId: string,
): Promise<MedicineDetail> {
  const medicine = await prisma.medicine.findFirst({
    where: {
      id: medicineId,
      isActive: true,
    },
    select: medicineDetailSelect,
  });

  if (!medicine) {
    throw new ApiError(404, "Medicine not found.", "MEDICINE_NOT_FOUND");
  }

  return toMedicineDetail(medicine);
}
