import { InventoryStatus } from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { INVENTORY_FRESHNESS_THRESHOLD_MS } from "../utils/inventoryFreshness.js";
import { getActivePharmacyMembership } from "./pharmacyMembership.service.js";

const dashboardPharmacySelect = {
  id: true,
  name: true,
  isVerified: true,
  isActive: true,
  partnerStatus: true,
  inventoryManagementMode: true,
} as const;

function pharmacyAccessDeniedError() {
  return new ApiError(
    403,
    "You do not have permission to access this pharmacy.",
    "FORBIDDEN",
  );
}

function pharmacyNotFoundError() {
  return new ApiError(404, "Pharmacy not found.", "PHARMACY_NOT_FOUND");
}

export async function getPharmacyDashboard(
  userId: string,
  pharmacyId: string,
) {
  const membership = await getActivePharmacyMembership(userId, pharmacyId);

  if (!membership) {
    throw pharmacyAccessDeniedError();
  }

  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: dashboardPharmacySelect,
  });

  if (!pharmacy) {
    throw pharmacyNotFoundError();
  }

  const now = new Date();
  const freshnessCutoff = new Date(
    now.getTime() - INVENTORY_FRESHNESS_THRESHOLD_MS,
  );
  const pharmacyWhere = { pharmacyId };

  const [totals, availabilityGroups, fresh, stale, requiresPrescription, doesNotRequirePrescription] =
    await Promise.all([
      prisma.pharmacyInventory.aggregate({
        where: pharmacyWhere,
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      prisma.pharmacyInventory.groupBy({
        by: ["availability"],
        where: pharmacyWhere,
        _count: { _all: true },
      }),
      prisma.pharmacyInventory.count({
        where: { pharmacyId, lastUpdated: { gte: freshnessCutoff } },
      }),
      prisma.pharmacyInventory.count({
        where: { pharmacyId, lastUpdated: { lt: freshnessCutoff } },
      }),
      prisma.pharmacyInventory.count({
        where: { pharmacyId, medicine: { requiresPrescription: true } },
      }),
      prisma.pharmacyInventory.count({
        where: { pharmacyId, medicine: { requiresPrescription: false } },
      }),
    ]);

  const byAvailability: Record<InventoryStatus, number> = {
    [InventoryStatus.AVAILABLE]: 0,
    [InventoryStatus.LOW_STOCK]: 0,
    [InventoryStatus.OUT_OF_STOCK]: 0,
    [InventoryStatus.UNAVAILABLE]: 0,
  };

  for (const group of availabilityGroups) {
    byAvailability[group.availability] = group._count._all;
  }

  return {
    pharmacy: {
      id: pharmacy.id,
      name: pharmacy.name,
      isVerified: pharmacy.isVerified,
      isActive: pharmacy.isActive,
      partnerStatus: pharmacy.partnerStatus,
      inventoryManagementMode: pharmacy.inventoryManagementMode,
    },
    inventorySummary: {
      totalRecords: totals._count._all,
      totalUnits: totals._sum.quantity ?? 0,
      byAvailability,
      freshness: { fresh, stale },
      prescriptionRequirement: {
        requiresPrescription,
        doesNotRequirePrescription,
      },
    },
  };
}
