import {
  PharmacyPartnerStatus,
  PharmacyStaffRole,
  type InventoryManagementMode,
} from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";
import type { UpdatePharmacyProfileInput } from "../validators/pharmacy.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import { isRecordNotFoundError } from "../utils/prismaErrors.js";
import { getActivePharmacyMembership } from "./pharmacyMembership.service.js";

type PublicPharmacyRecord = {
  id: string;
  name: string;
  description: string | null;
  phone: string;
  email: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
};

type OperationalPharmacyRecord = PublicPharmacyRecord & {
  licenseNumber: string | null;
  isVerified: boolean;
  isActive: boolean;
  partnerStatus: PharmacyPartnerStatus;
  inventoryManagementMode: InventoryManagementMode;
  createdAt: Date;
  updatedAt: Date;
};

type PharmacyUpdateData = Partial<
  Pick<
    OperationalPharmacyRecord,
    | "name"
    | "description"
    | "phone"
    | "email"
    | "addressLine1"
    | "addressLine2"
    | "city"
    | "state"
    | "postalCode"
    | "latitude"
    | "longitude"
  >
>;

const publicPharmacySelect = {
  id: true,
  name: true,
  description: true,
  phone: true,
  email: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  latitude: true,
  longitude: true,
} as const;

const operationalPharmacySelect = {
  ...publicPharmacySelect,
  licenseNumber: true,
  isVerified: true,
  isActive: true,
  partnerStatus: true,
  inventoryManagementMode: true,
  createdAt: true,
  updatedAt: true,
} as const;

function pharmacyNotFoundError() {
  return new ApiError(404, "Pharmacy not found.", "PHARMACY_NOT_FOUND");
}

function pharmacyAccessDeniedError() {
  return new ApiError(
    403,
    "You do not have permission to access this pharmacy.",
    "FORBIDDEN",
  );
}

function toPublicPharmacyProfile(
  pharmacy: PublicPharmacyRecord,
): PublicPharmacyRecord {
  return {
    id: pharmacy.id,
    name: pharmacy.name,
    description: pharmacy.description,
    phone: pharmacy.phone,
    email: pharmacy.email,
    addressLine1: pharmacy.addressLine1,
    addressLine2: pharmacy.addressLine2,
    city: pharmacy.city,
    state: pharmacy.state,
    postalCode: pharmacy.postalCode,
    latitude: pharmacy.latitude,
    longitude: pharmacy.longitude,
  };
}

function toOperationalPharmacyProfile(
  pharmacy: OperationalPharmacyRecord,
): OperationalPharmacyRecord {
  return {
    ...toPublicPharmacyProfile(pharmacy),
    licenseNumber: pharmacy.licenseNumber,
    isVerified: pharmacy.isVerified,
    isActive: pharmacy.isActive,
    partnerStatus: pharmacy.partnerStatus,
    inventoryManagementMode: pharmacy.inventoryManagementMode,
    createdAt: pharmacy.createdAt,
    updatedAt: pharmacy.updatedAt,
  };
}

export async function getPublicPharmacyProfile(
  pharmacyId: string,
): Promise<PublicPharmacyRecord> {
  const pharmacy = await prisma.pharmacy.findFirst({
    where: {
      id: pharmacyId,
      isActive: true,
      isVerified: true,
      partnerStatus: PharmacyPartnerStatus.ACTIVE,
    },
    select: publicPharmacySelect,
  });

  if (!pharmacy) {
    throw pharmacyNotFoundError();
  }

  return toPublicPharmacyProfile(pharmacy);
}

async function requirePharmacyMembership(userId: string, pharmacyId: string) {
  const membership = await getActivePharmacyMembership(userId, pharmacyId);

  if (!membership) {
    throw pharmacyAccessDeniedError();
  }

  return membership;
}

export async function getOperationalPharmacyProfile(
  userId: string,
  pharmacyId: string,
): Promise<OperationalPharmacyRecord> {
  await requirePharmacyMembership(userId, pharmacyId);

  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: operationalPharmacySelect,
  });

  if (!pharmacy) {
    throw pharmacyNotFoundError();
  }

  return toOperationalPharmacyProfile(pharmacy);
}

export async function updateOperationalPharmacyProfile(
  userId: string,
  pharmacyId: string,
  input: UpdatePharmacyProfileInput,
): Promise<OperationalPharmacyRecord> {
  const membership = await requirePharmacyMembership(userId, pharmacyId);

  if (
    membership.role !== PharmacyStaffRole.OWNER &&
    membership.role !== PharmacyStaffRole.MANAGER
  ) {
    throw pharmacyAccessDeniedError();
  }

  const data: PharmacyUpdateData = {};
  const allowedFields = [
    "name",
    "description",
    "phone",
    "email",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "postalCode",
    "latitude",
    "longitude",
  ] as const;

  for (const field of allowedFields) {
    if (field in input) {
      Object.assign(data, { [field]: input[field] });
    }
  }

  try {
    const pharmacy = await prisma.pharmacy.update({
      where: { id: pharmacyId },
      data,
      select: operationalPharmacySelect,
    });

    return toOperationalPharmacyProfile(pharmacy);
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      throw pharmacyNotFoundError();
    }

    throw error;
  }
}
