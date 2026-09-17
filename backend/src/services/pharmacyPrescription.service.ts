import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import type { PharmacyPrescriptionListQuery } from "../validators/pharmacyPrescription.schemas.js";
import { getActivePharmacyMembership } from "./pharmacyMembership.service.js";

const prescriptionSelect = {
  id: true,
  orderId: true,
  status: true,
  uploadedAt: true,
  reviewedAt: true,
  reviewNotes: true,
  rejectionReason: true,
  supersedesPrescriptionId: true,
  supersededByPrescription: { select: { id: true } },
  order: { select: { id: true, orderNumber: true, status: true } },
} satisfies Prisma.PrescriptionSelect;

async function requireMembership(userId: string, pharmacyId: string) {
  if (!(await getActivePharmacyMembership(userId, pharmacyId))) {
    throw new ApiError(403, "Forbidden.", "FORBIDDEN");
  }
}

export async function listPharmacyPrescriptions(
  userId: string,
  pharmacyId: string,
  query: PharmacyPrescriptionListQuery,
) {
  await requireMembership(userId, pharmacyId);
  const records = await prisma.prescription.findMany({
    where: {
      order: { pharmacyId },
      ...(query.status === undefined ? {} : { status: query.status }),
    },
    select: prescriptionSelect,
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
  });
  const hasMore = records.length > query.limit;
  const page = hasMore ? records.slice(0, query.limit) : records;
  return {
    prescriptions: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

export async function getPharmacyPrescription(
  userId: string,
  pharmacyId: string,
  prescriptionId: string,
) {
  await requireMembership(userId, pharmacyId);
  const prescription = await prisma.prescription.findFirst({
    where: { id: prescriptionId, order: { pharmacyId } },
    select: prescriptionSelect,
  });
  if (!prescription) {
    throw new ApiError(404, "Prescription not found.", "PRESCRIPTION_NOT_FOUND");
  }
  return prescription;
}
