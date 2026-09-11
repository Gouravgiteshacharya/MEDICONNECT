import {
  InventoryStatus,
  PharmacyPartnerStatus,
} from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import {
  calculateGeographicBoundingBox,
  haversineDistanceKm,
  roundDistanceKm,
  type LongitudeRange,
} from "../utils/distance.js";
import { classifyInventoryFreshness } from "../utils/inventoryFreshness.js";
import type { MedicineAvailabilityQuery } from "../validators/medicineAvailability.schemas.js";

type DecimalPrice = {
  toFixed(decimalPlaces: number): string;
};

type CandidateRecord = {
  quantity: number;
  sellingPrice: DecimalPrice;
  availability: InventoryStatus;
  lastUpdated: Date;
  pharmacy: {
    id: string;
    name: string;
    phone: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    latitude: number | null;
    longitude: number | null;
  };
};

const publicMedicineSelect = {
  id: true,
  name: true,
  brandName: true,
  genericName: true,
  manufacturer: true,
  requiresPrescription: true,
} as const;

const availabilityCandidateSelect = {
  quantity: true,
  sellingPrice: true,
  availability: true,
  lastUpdated: true,
  pharmacy: {
    select: {
      id: true,
      name: true,
      phone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      latitude: true,
      longitude: true,
    },
  },
} as const;

function longitudeWhere(longitudeRanges: LongitudeRange[] | null) {
  if (!longitudeRanges) {
    return { longitude: { not: null } };
  }

  if (longitudeRanges.length === 1) {
    return {
      longitude: {
        not: null,
        gte: longitudeRanges[0].min,
        lte: longitudeRanges[0].max,
      },
    };
  }

  return {
    longitude: { not: null },
    OR: longitudeRanges.map((range) => ({
      longitude: { gte: range.min, lte: range.max },
    })),
  };
}

function compareAvailability(
  left: { exactDistanceKm: number; pharmacy: { name: string; id: string } },
  right: { exactDistanceKm: number; pharmacy: { name: string; id: string } },
) {
  const distanceDifference = left.exactDistanceKm - right.exactDistanceKm;
  if (distanceDifference !== 0) return distanceDifference;
  if (left.pharmacy.name < right.pharmacy.name) return -1;
  if (left.pharmacy.name > right.pharmacy.name) return 1;
  if (left.pharmacy.id < right.pharmacy.id) return -1;
  if (left.pharmacy.id > right.pharmacy.id) return 1;
  return 0;
}

export async function getNearbyMedicineAvailability(
  medicineId: string,
  input: MedicineAvailabilityQuery,
) {
  const medicine = await prisma.medicine.findFirst({
    where: { id: medicineId, isActive: true },
    select: publicMedicineSelect,
  });

  if (!medicine) {
    throw new ApiError(404, "Medicine not found.", "MEDICINE_NOT_FOUND");
  }

  const boundingBox = calculateGeographicBoundingBox(
    input.latitude,
    input.longitude,
    input.radiusKm,
  );
  const candidates = await prisma.pharmacyInventory.findMany({
    where: {
      medicineId,
      quantity: { gt: 0 },
      availability: {
        in: [InventoryStatus.AVAILABLE, InventoryStatus.LOW_STOCK],
      },
      pharmacy: {
        isActive: true,
        isVerified: true,
        partnerStatus: PharmacyPartnerStatus.ACTIVE,
        latitude: {
          not: null,
          gte: boundingBox.minLatitude,
          lte: boundingBox.maxLatitude,
        },
        ...longitudeWhere(boundingBox.longitudeRanges),
      },
    },
    select: availabilityCandidateSelect,
  });
  const now = new Date();
  const nearby = candidates
    .flatMap((candidate: CandidateRecord) => {
      const { latitude, longitude } = candidate.pharmacy;
      if (latitude === null || longitude === null) return [];

      const exactDistanceKm = haversineDistanceKm(
        input.latitude,
        input.longitude,
        latitude,
        longitude,
      );
      if (exactDistanceKm > input.radiusKm) return [];

      return [
        {
          exactDistanceKm,
          pharmacy: {
            id: candidate.pharmacy.id,
            name: candidate.pharmacy.name,
            phone: candidate.pharmacy.phone,
            addressLine1: candidate.pharmacy.addressLine1,
            addressLine2: candidate.pharmacy.addressLine2,
            city: candidate.pharmacy.city,
            state: candidate.pharmacy.state,
            postalCode: candidate.pharmacy.postalCode,
            latitude,
            longitude,
          },
          quantity: candidate.quantity,
          sellingPrice: candidate.sellingPrice.toFixed(2),
          availability: candidate.availability,
          lastUpdated: candidate.lastUpdated,
          freshness: classifyInventoryFreshness(candidate.lastUpdated, now),
          distanceKm: roundDistanceKm(exactDistanceKm),
        },
      ];
    })
    .sort(compareAvailability);
  const total = nearby.length;
  const offset = (input.page - 1) * input.pageSize;
  const availability = nearby.slice(offset, offset + input.pageSize).map(
    ({ exactDistanceKm: _exactDistanceKm, ...result }) => result,
  );

  return {
    medicine: {
      id: medicine.id,
      name: medicine.name,
      brandName: medicine.brandName,
      genericName: medicine.genericName,
      manufacturer: medicine.manufacturer,
      requiresPrescription: medicine.requiresPrescription,
    },
    availability,
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
    search: {
      latitude: input.latitude,
      longitude: input.longitude,
      radiusKm: input.radiusKm,
    },
  };
}
