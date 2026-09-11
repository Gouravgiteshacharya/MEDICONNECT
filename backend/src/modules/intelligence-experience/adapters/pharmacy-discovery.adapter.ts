import { listUserAddresses } from "../../../services/address.service.js";
import { getNearbyMedicineAvailability } from "../../../services/medicineAvailability.service.js";
import { listMedicines } from "../../../services/medicine.service.js";
import { ApiError } from "../../../utils/ApiError.js";
import type {
  MedicineDiscoveryAdapter,
  MedicineDiscoveryData,
  MedicineDiscoveryQuery,
  ToolExecutionResult,
  TrustedAssistantContext,
} from "../contracts.js";

const DEFAULT_RADIUS_KM = 5;
const DISCOVERY_PAGE_SIZE = 20;

export interface PharmacyDiscoveryDependencies {
  readonly searchMedicines: typeof listMedicines;
  readonly listAddresses: typeof listUserAddresses;
  readonly getAvailability: typeof getNearbyMedicineAvailability;
}

const productionDependencies: PharmacyDiscoveryDependencies = {
  searchMedicines: listMedicines,
  listAddresses: listUserAddresses,
  getAvailability: getNearbyMedicineAvailability,
};

export function createPharmacyDiscoveryAdapter(
  dependencies: PharmacyDiscoveryDependencies = productionDependencies,
): MedicineDiscoveryAdapter {
  return {
    discover: (query, context) => discover(query, context, dependencies),
  };
}

async function discover(
  query: MedicineDiscoveryQuery,
  context: TrustedAssistantContext,
  dependencies: PharmacyDiscoveryDependencies,
): Promise<ToolExecutionResult<MedicineDiscoveryData>> {
  if (query.discoveryType === "pharmacy") {
    return error("unavailable", "Nearby pharmacy discovery is not connected yet.");
  }

  const medicineName = query.medicineName?.trim();
  if (!medicineName) return error("invalid_request", "Please provide a medicine name.");

  const radiusKm = query.radiusKm ?? DEFAULT_RADIUS_KM;
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 50) {
    return error("invalid_request", "Medicine search radius must be between 0 and 50 km.");
  }

  try {
    const addresses = await dependencies.listAddresses(context.userId);
    const defaultAddress = addresses.find(({ isDefault }) => isDefault);
    if (!defaultAddress || defaultAddress.latitude === null || defaultAddress.longitude === null) {
      return error(
        "invalid_request",
        "Add a default address with location information before searching nearby medicine availability.",
      );
    }

    const catalogue = await dependencies.searchMedicines({
      q: medicineName,
      page: 1,
      pageSize: DISCOVERY_PAGE_SIZE,
    });
    const normalizedQuery = normalize(medicineName);
    const exactMatches = catalogue.medicines.filter((medicine) =>
      normalize(medicine.name) === normalizedQuery
      || (medicine.brandName !== null && normalize(medicine.brandName) === normalizedQuery));
    const uniqueMatches = [...new Map(exactMatches.map((medicine) => [medicine.id, medicine])).values()];

    if (uniqueMatches.length === 0) {
      return error("not_found", `No exact medicine match was found for ${medicineName}.`);
    }
    if (uniqueMatches.length > 1) {
      return error("invalid_request", "More than one medicine matched that name. Please provide a more specific product name.");
    }

    const medicine = uniqueMatches[0];
    if (!medicine) return error("execution_failed", "Medicine availability could not be retrieved.");
    const availability = await dependencies.getAvailability(medicine.id, {
      latitude: defaultAddress.latitude,
      longitude: defaultAddress.longitude,
      radiusKm,
      page: 1,
      pageSize: DISCOVERY_PAGE_SIZE,
    });

    return {
      status: "success",
      data: {
        medicine: {
          name: availability.medicine.name,
          brandName: availability.medicine.brandName,
          genericName: availability.medicine.genericName,
          requiresPrescription: availability.medicine.requiresPrescription,
        },
        pharmacies: availability.availability.map((item) => {
          const customerAvailability = item.availability === "AVAILABLE"
            ? "AVAILABLE" as const
            : item.availability === "LOW_STOCK"
              ? "LOW_STOCK" as const
              : undefined;
          if (!customerAvailability) throw new Error("Pharmacy returned non-orderable availability");
          return {
            name: item.pharmacy.name,
            address: {
              addressLine1: item.pharmacy.addressLine1,
              addressLine2: item.pharmacy.addressLine2,
              city: item.pharmacy.city,
              state: item.pharmacy.state,
              postalCode: item.pharmacy.postalCode,
            },
            availability: customerAvailability,
            quantity: item.quantity,
            sellingPrice: item.sellingPrice,
            distanceKm: item.distanceKm,
            inventory: {
              freshness: item.freshness,
              lastUpdated: item.lastUpdated.toISOString(),
            },
          };
        }),
        radiusKm,
      },
    };
  } catch (caught) {
    return translateError(caught);
  }
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function translateError(caught: unknown): ToolExecutionResult<never> {
  if (caught instanceof ApiError) {
    if (caught.code === "MEDICINE_NOT_FOUND" || caught.code === "PHARMACY_NOT_FOUND") {
      return error("not_found", "The requested medicine or pharmacy could not be found.");
    }
    if (caught.code === "FORBIDDEN") return error("forbidden", "You do not have access to this information.");
    if (caught.code === "UNAVAILABLE" || caught.code === "SERVICE_UNAVAILABLE") {
      return error("unavailable", "Medicine availability is currently unavailable.");
    }
  }
  return error("execution_failed", "Medicine availability could not be retrieved.");
}

function error(
  code: "invalid_request" | "not_found" | "forbidden" | "unavailable" | "execution_failed",
  message: string,
): ToolExecutionResult<never> {
  return { status: "error", code, message };
}
