import type { Prisma } from "../../generated/prisma/client.js";
import { OrderStatus, PharmacyPartnerStatus, PrescriptionStatus } from "../../generated/prisma/client.js";
import { LIVE_ASSIGNMENT_STATUSES } from "../delivery-assignments/assignment.service.js";
import type { AdminOrderListQuery } from "../validators/admin.schemas.js";
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

const orderSummarySelect = {
  id: true, orderNumber: true, pharmacyId: true, status: true, fulfillmentMethod: true,
  medicineSubtotal: true, deliveryFee: true, totalAmount: true,
  placedAt: true, confirmedAt: true, completedAt: true, cancelledAt: true,
  pharmacy: { select: { id: true, name: true } },
} satisfies Prisma.OrderSelect;
const orderDetailSelect = {
  ...orderSummarySelect,
  createdAt: true, updatedAt: true,
  customer: { select: { id: true, name: true, email: true, phone: true } },
  items: {
    select: {
      id: true, medicineId: true, medicineNameSnapshot: true, brandNameSnapshot: true,
      manufacturerSnapshot: true, requiresPrescription: true, quantity: true,
      unitPrice: true, lineTotal: true,
    },
    orderBy: { id: "asc" },
  },
  prescriptions: {
    select: {
      id: true, status: true, uploadedAt: true, reviewedAt: true,
      reviewNotes: true, rejectionReason: true, supersedesPrescriptionId: true,
      supersededByPrescription: { select: { id: true } },
    },
    orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.OrderSelect;

export async function listAdminOrders(query: AdminOrderListQuery) {
  const { limit, cursor, requiresPrescription, prescriptionStatus, ...filters } = query;
  const records = await prisma.order.findMany({
    where: {
      ...filters,
      ...(requiresPrescription === undefined ? {} : {
        items: requiresPrescription
          ? { some: { requiresPrescription: true } }
          : { none: { requiresPrescription: true } },
      }),
      ...(prescriptionStatus === undefined ? {} : {
        prescriptions: { some: { status: prescriptionStatus, supersededByPrescription: null } },
      }),
    },
    select: { ...orderSummarySelect, _count: { select: { items: true } } },
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
  });
  const { page, nextCursor } = pageOf(records, limit);
  return {
    orders: page.map(({ _count, ...order }) => ({ ...order, itemCount: _count.items })),
    nextCursor,
  };
}

export async function getAdminOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: orderDetailSelect });
  if (!order) throw new ApiError(404, "Order not found.", "ORDER_NOT_FOUND");
  return order;
}

export async function getAdminOperationsSummary() {
  const cutoff = new Date(Date.now() - INVENTORY_FRESHNESS_THRESHOLD_MS);
  const [activePharmacies, openOrders, pendingPrescriptionReviews, staleInventory, activeDeliveries] = await Promise.all([
    prisma.pharmacy.count({ where: {
      isActive: true, isVerified: true, partnerStatus: PharmacyPartnerStatus.ACTIVE,
    } }),
    prisma.order.count({ where: { status: { notIn: [
      OrderStatus.PRESCRIPTION_REJECTED, OrderStatus.REJECTED_BY_PHARMACY,
      OrderStatus.CANCELLED, OrderStatus.DELIVERED, OrderStatus.PICKED_UP_BY_CUSTOMER,
    ] } } }),
    prisma.prescription.count({ where: {
      status: PrescriptionStatus.PENDING_REVIEW,
      supersededByPrescription: null,
      order: { status: OrderStatus.PRESCRIPTION_PENDING },
    } }),
    prisma.pharmacyInventory.count({ where: { lastUpdated: { lt: cutoff } } }),
    prisma.deliveryAssignment.count({ where: { status: { in: [...LIVE_ASSIGNMENT_STATUSES] } } }),
  ]);
  return { activePharmacies, openOrders, pendingPrescriptionReviews, staleInventory, activeDeliveries };
}
