import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import type { PharmacyOrderListQuery } from "../validators/pharmacyOrder.schemas.js";
import { getActivePharmacyMembership } from "./pharmacyMembership.service.js";

const orderSummarySelect = {
  id: true,
  orderNumber: true,
  pharmacyId: true,
  fulfillmentMethod: true,
  status: true,
  medicineSubtotal: true,
  deliveryFee: true,
  totalAmount: true,
  placedAt: true,
  confirmedAt: true,
  completedAt: true,
  cancelledAt: true,
} satisfies Prisma.OrderSelect;

const orderDetailSelect = {
  ...orderSummarySelect,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      medicineId: true,
      medicineNameSnapshot: true,
      brandNameSnapshot: true,
      manufacturerSnapshot: true,
      requiresPrescription: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
    },
    orderBy: { id: "asc" },
  },
  prescriptions: {
    select: {
      id: true,
      status: true,
      uploadedAt: true,
      reviewedAt: true,
      reviewNotes: true,
      rejectionReason: true,
      supersedesPrescriptionId: true,
    },
    orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.OrderSelect;

async function requireMembership(userId: string, pharmacyId: string) {
  if (!(await getActivePharmacyMembership(userId, pharmacyId))) {
    throw new ApiError(403, "Forbidden.", "FORBIDDEN");
  }
}

export async function listPharmacyOrders(
  userId: string,
  pharmacyId: string,
  query: PharmacyOrderListQuery,
) {
  await requireMembership(userId, pharmacyId);
  const records = await prisma.order.findMany({
    where: {
      pharmacyId,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.fulfillmentMethod === undefined
        ? {}
        : { fulfillmentMethod: query.fulfillmentMethod }),
    },
    select: { ...orderSummarySelect, _count: { select: { items: true } } },
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
  });
  const hasMore = records.length > query.limit;
  const page = hasMore ? records.slice(0, query.limit) : records;
  return {
    orders: page.map(({ _count, ...order }) => ({ ...order, itemCount: _count.items })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

export async function getPharmacyOrder(userId: string, pharmacyId: string, orderId: string) {
  await requireMembership(userId, pharmacyId);
  const order = await prisma.order.findFirst({
    where: { id: orderId, pharmacyId },
    select: orderDetailSelect,
  });
  if (!order) throw new ApiError(404, "Order not found.", "ORDER_NOT_FOUND");
  return order;
}
