import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { classifyInventoryFreshness, INVENTORY_FRESHNESS_THRESHOLD_MS } from "../utils/inventoryFreshness.js";
import type { AdminInventoryListQuery, AdminPharmacyListQuery } from "../validators/admin.schemas.js";

const pharmacySummarySelect = {
  id: true, name: true, city: true, state: true,
  isActive: true, isVerified: true, partnerStatus: true,
  inventoryManagementMode: true, createdAt: true, updatedAt: true,
} satisfies Prisma.PharmacySelect;
const pharmacyDetailSelect = {
  ...pharmacySummarySelect,
  description: true, phone: true, email: true, licenseNumber: true,
  addressLine1: true, addressLine2: true, postalCode: true,
  latitude: true, longitude: true,
} satisfies Prisma.PharmacySelect;
const inventorySelect = {
  id: true, quantity: true, sellingPrice: true, availability: true,
  lastUpdated: true, updatedAt: true,
  pharmacy: { select: { id: true, name: true } },
  medicine: { select: { id: true, name: true } },
} satisfies Prisma.PharmacyInventorySelect;

function pageOf<T extends { id: string }>(records: T[], limit: number) {
  const hasMore = records.length > limit;
  const page = hasMore ? records.slice(0, limit) : records;
  return { page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
}

export async function listAdminPharmacies(query: AdminPharmacyListQuery) {
  const { limit, cursor, ...where } = query;
  const records = await prisma.pharmacy.findMany({
    where, select: pharmacySummarySelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
  });
  const { page, nextCursor } = pageOf(records, limit);
  return { pharmacies: page, nextCursor };
}

export async function getAdminPharmacy(pharmacyId: string) {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId }, select: pharmacyDetailSelect,
  });
  if (!pharmacy) throw new ApiError(404, "Pharmacy not found.", "PHARMACY_NOT_FOUND");
  return pharmacy;
}

export async function listAdminInventory(query: AdminInventoryListQuery) {
  const { limit, cursor, freshness, ...filters } = query;
  const now = new Date();
  const cutoff = new Date(now.getTime() - INVENTORY_FRESHNESS_THRESHOLD_MS);
  const records = await prisma.pharmacyInventory.findMany({
    where: {
      ...filters,
      ...(freshness === undefined ? {} : {
        lastUpdated: freshness === "FRESH" ? { gte: cutoff } : { lt: cutoff },
      }),
    },
    select: inventorySelect,
    orderBy: [{ lastUpdated: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
  });
  const { page, nextCursor } = pageOf(records, limit);
  return {
    inventory: page.map((record) => ({
      id: record.id,
      pharmacy: { id: record.pharmacy.id, name: record.pharmacy.name },
      medicine: { id: record.medicine.id, name: record.medicine.name },
      quantity: record.quantity,
      sellingPrice: record.sellingPrice.toFixed(2),
      availability: record.availability,
      lastUpdated: record.lastUpdated,
      updatedAt: record.updatedAt,
      freshness: classifyInventoryFreshness(record.lastUpdated, now),
    })),
    nextCursor,
  };
}
