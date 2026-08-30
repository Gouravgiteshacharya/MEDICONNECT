import {
  InventoryStatus,
  PharmacyStaffRole,
} from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import {
  isRecordNotFoundError,
  isUniqueConstraintError,
} from "../utils/prismaErrors.js";
import type {
  CreateInventoryInput,
  InventoryListQuery,
  UpdateInventoryInput,
} from "../validators/inventory.schemas.js";
import { getActivePharmacyMembership } from "./pharmacyMembership.service.js";

export const INVENTORY_FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1_000;

type DecimalPrice = {
  toFixed(decimalPlaces: number): string;
};

type InventoryRecord = {
  id: string;
  quantity: number;
  sellingPrice: DecimalPrice;
  availability: InventoryStatus;
  lastUpdated: Date;
  updatedAt: Date;
  medicine: {
    id: string;
    name: string;
    brandName: string | null;
    genericName: string | null;
    manufacturer: string | null;
    requiresPrescription: boolean;
  };
};

const inventoryItemSelect = {
  id: true,
  quantity: true,
  sellingPrice: true,
  availability: true,
  lastUpdated: true,
  updatedAt: true,
  medicine: {
    select: {
      id: true,
      name: true,
      brandName: true,
      genericName: true,
      manufacturer: true,
      requiresPrescription: true,
    },
  },
} as const;

function inventoryNotFoundError() {
  return new ApiError(404, "Inventory item not found.", "INVENTORY_NOT_FOUND");
}

function inventoryAccessDeniedError() {
  return new ApiError(
    403,
    "You do not have permission to access this pharmacy inventory.",
    "FORBIDDEN",
  );
}

async function requireInventoryMembership(userId: string, pharmacyId: string) {
  const membership = await getActivePharmacyMembership(userId, pharmacyId);

  if (!membership) {
    throw inventoryAccessDeniedError();
  }

  return membership;
}

async function requireInventoryWriter(userId: string, pharmacyId: string) {
  const membership = await requireInventoryMembership(userId, pharmacyId);

  if (
    membership.role !== PharmacyStaffRole.OWNER &&
    membership.role !== PharmacyStaffRole.MANAGER
  ) {
    throw inventoryAccessDeniedError();
  }

  return membership;
}

export function classifyInventoryFreshness(
  lastUpdated: Date,
  now = new Date(),
): "FRESH" | "STALE" {
  return now.getTime() - lastUpdated.getTime() <= INVENTORY_FRESHNESS_THRESHOLD_MS
    ? "FRESH"
    : "STALE";
}

function toInventoryItem(record: InventoryRecord, now = new Date()) {
  return {
    id: record.id,
    medicine: {
      id: record.medicine.id,
      name: record.medicine.name,
      brandName: record.medicine.brandName,
      genericName: record.medicine.genericName,
      manufacturer: record.medicine.manufacturer,
      requiresPrescription: record.medicine.requiresPrescription,
    },
    quantity: record.quantity,
    sellingPrice: record.sellingPrice.toFixed(2),
    availability: record.availability,
    lastUpdated: record.lastUpdated,
    updatedAt: record.updatedAt,
    freshness: classifyInventoryFreshness(record.lastUpdated, now),
  };
}

export async function listPharmacyInventory(
  userId: string,
  pharmacyId: string,
  input: InventoryListQuery,
) {
  await requireInventoryMembership(userId, pharmacyId);

  const where = {
    pharmacyId,
    ...(input.availability ? { availability: input.availability } : {}),
    ...(input.q
      ? {
          medicine: {
            OR: [
              { name: { contains: input.q, mode: "insensitive" as const } },
              {
                brandName: {
                  contains: input.q,
                  mode: "insensitive" as const,
                },
              },
              {
                genericName: {
                  contains: input.q,
                  mode: "insensitive" as const,
                },
              },
              {
                manufacturer: {
                  contains: input.q,
                  mode: "insensitive" as const,
                },
              },
            ],
          },
        }
      : {}),
  };

  const [records, total] = await Promise.all([
    prisma.pharmacyInventory.findMany({
      where,
      select: inventoryItemSelect,
      orderBy: [{ medicine: { name: "asc" } }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.pharmacyInventory.count({ where }),
  ]);
  const now = new Date();

  return {
    inventory: records.map((record) => toInventoryItem(record, now)),
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function getPharmacyInventoryItem(
  userId: string,
  pharmacyId: string,
  inventoryId: string,
) {
  await requireInventoryMembership(userId, pharmacyId);

  const record = await prisma.pharmacyInventory.findFirst({
    where: { id: inventoryId, pharmacyId },
    select: inventoryItemSelect,
  });

  if (!record) {
    throw inventoryNotFoundError();
  }

  return toInventoryItem(record);
}

export async function createPharmacyInventoryItem(
  userId: string,
  pharmacyId: string,
  input: CreateInventoryInput,
) {
  await requireInventoryWriter(userId, pharmacyId);

  const medicine = await prisma.medicine.findFirst({
    where: { id: input.medicineId, isActive: true },
    select: { id: true },
  });

  if (!medicine) {
    throw new ApiError(404, "Medicine not found.", "MEDICINE_NOT_FOUND");
  }

  const lastUpdated = new Date();

  try {
    const record = await prisma.pharmacyInventory.create({
      data: {
        pharmacyId,
        medicineId: input.medicineId,
        quantity: input.quantity,
        sellingPrice: input.sellingPrice,
        availability: input.availability,
        updatedByUserId: userId,
        lastUpdated,
      },
      select: inventoryItemSelect,
    });

    return toInventoryItem(record, lastUpdated);
  } catch (error) {
    if (
      isUniqueConstraintError(error, "pharmacyId") &&
      isUniqueConstraintError(error, "medicineId")
    ) {
      throw new ApiError(
        409,
        "Inventory already exists for this medicine.",
        "INVENTORY_ALREADY_EXISTS",
      );
    }

    throw error;
  }
}

export async function updatePharmacyInventoryItem(
  userId: string,
  pharmacyId: string,
  inventoryId: string,
  input: UpdateInventoryInput,
) {
  await requireInventoryWriter(userId, pharmacyId);

  const existing = await prisma.pharmacyInventory.findFirst({
    where: { id: inventoryId, pharmacyId },
    select: { id: true },
  });

  if (!existing) {
    throw inventoryNotFoundError();
  }

  const lastUpdated = new Date();
  const data: {
    quantity?: number;
    sellingPrice?: string;
    availability?: InventoryStatus;
    updatedByUserId: string;
    lastUpdated: Date;
  } = {
    updatedByUserId: userId,
    lastUpdated,
  };

  if ("quantity" in input) data.quantity = input.quantity;
  if ("sellingPrice" in input) data.sellingPrice = input.sellingPrice;
  if ("availability" in input) data.availability = input.availability;

  try {
    const record = await prisma.pharmacyInventory.update({
      where: { id: inventoryId },
      data,
      select: inventoryItemSelect,
    });

    return toInventoryItem(record, lastUpdated);
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      throw inventoryNotFoundError();
    }

    throw error;
  }
}
