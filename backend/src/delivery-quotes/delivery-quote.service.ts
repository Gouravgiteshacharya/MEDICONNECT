import { ApiError } from "../middleware/errors.js";
import type { RiderStore } from "../riders/rider.service.js";
import type { DeliveryQuoteConfig } from "./delivery-quote.config.js";
import { paiseToRupees } from "./delivery-quote.config.js";
import type { DeliveryQuoteInput } from "./delivery-quote.validation.js";
import type { DistanceProvider } from "./distance-provider.js";
import { calculateDeliveryPrice } from "./pricing.js";
import { validateCoordinates } from "../location/coordinates.js";

interface CustomerRecord { id: string; isActive: boolean; }
interface AddressRecord { id: string; userId: string; latitude: number | null; longitude: number | null; }
interface PharmacyRecord {
  id: string; latitude: number | null; longitude: number | null;
  isActive: boolean; isVerified: boolean; partnerStatus: string;
}
interface CreatedQuote { id: string; createdAt: Date; expiresAt: Date | null; }

export interface DeliveryQuoteStore extends RiderStore {
  user: { findFirst(args: unknown): Promise<CustomerRecord | null>; };
  address: { findFirst(args: unknown): Promise<AddressRecord | null>; };
  pharmacy: { findUnique(args: unknown): Promise<PharmacyRecord | null>; };
  deliveryQuote: { create(args: unknown): Promise<CreatedQuote>; };
}
export interface DeliveryQuoteServiceOptions {
  config: DeliveryQuoteConfig;
  distanceProvider: DistanceProvider;
  now: () => Date;
}

export async function createDeliveryQuote(
  store: DeliveryQuoteStore,
  customerId: string,
  input: DeliveryQuoteInput,
  options: DeliveryQuoteServiceOptions,
) {
  const eligibility = await store.$transaction(async (baseTransaction) => {
    const transaction = baseTransaction as DeliveryQuoteStore;
    const customer = await transaction.user.findFirst({ where: { id: customerId, role: "CUSTOMER" }, select: { id: true, isActive: true } });
    if (!customer?.isActive) throw new ApiError(403, "Customer account is inactive", "CUSTOMER_INACTIVE");

    const address = await transaction.address.findFirst({
      where: { id: input.deliveryAddressId, userId: customerId },
      select: { id: true, userId: true, latitude: true, longitude: true },
    });
    if (!address) throw new ApiError(404, "Delivery address not found", "ADDRESS_NOT_FOUND");
    if (address.latitude === null || address.longitude === null) {
      throw new ApiError(422, "Delivery address coordinates are unavailable", "DESTINATION_COORDINATES_UNAVAILABLE");
    }
    try { validateCoordinates({ latitude: address.latitude, longitude: address.longitude }); }
    catch { throw new ApiError(422, "Delivery address coordinates are unavailable", "DESTINATION_COORDINATES_UNAVAILABLE"); }

    const pharmacy = await transaction.pharmacy.findUnique({
      where: { id: input.pharmacyId },
      select: { id: true, latitude: true, longitude: true, isActive: true, isVerified: true, partnerStatus: true },
    });
    if (!pharmacy || !pharmacy.isActive || !pharmacy.isVerified || pharmacy.partnerStatus !== "ACTIVE") {
      throw new ApiError(422, "Pharmacy is unavailable or ineligible", "PHARMACY_INELIGIBLE");
    }
    if (pharmacy.latitude === null || pharmacy.longitude === null) {
      throw new ApiError(422, "Pharmacy coordinates are unavailable", "PHARMACY_COORDINATES_UNAVAILABLE");
    }
    try { validateCoordinates({ latitude: pharmacy.latitude, longitude: pharmacy.longitude }); }
    catch { throw new ApiError(422, "Pharmacy coordinates are unavailable", "PHARMACY_COORDINATES_UNAVAILABLE"); }

    return { address, pharmacy };
  });
  const { address, pharmacy } = eligibility;
  const deliveryLatitude = address.latitude as number;
  const deliveryLongitude = address.longitude as number;
  const pharmacyLatitude = pharmacy.latitude as number;
  const pharmacyLongitude = pharmacy.longitude as number;

  // Routing providers may perform network I/O and must never run inside a database transaction.
    let estimate;
    try {
      estimate = await options.distanceProvider.calculate(
        { latitude: pharmacyLatitude, longitude: pharmacyLongitude },
        { latitude: deliveryLatitude, longitude: deliveryLongitude },
      );
      if (!Number.isFinite(estimate.distanceKm) || estimate.distanceKm < 0
        || (estimate.durationMinutes !== undefined && (!Number.isInteger(estimate.durationMinutes) || estimate.durationMinutes < 0))) {
        throw new Error("Distance provider returned an invalid estimate");
      }
    } catch {
      throw new ApiError(502, "Unable to calculate delivery distance", "DISTANCE_PROVIDER_FAILED");
    }

    const pricing = calculateDeliveryPrice(estimate.distanceKm, options.config);
    const createdAt = options.now();
    if (!Number.isFinite(createdAt.getTime())) throw new Error("Quote clock returned an invalid date");
    const expiresAt = new Date(createdAt.getTime() + options.config.expiryMs);
    const money = {
      baseFee: paiseToRupees(pricing.baseFeePaise),
      distanceFee: paiseToRupees(pricing.distanceFeePaise),
      demandAdjustment: paiseToRupees(pricing.demandAdjustmentPaise),
      demandMultiplier: pricing.demandMultiplier,
      finalDeliveryFee: paiseToRupees(pricing.finalDeliveryFeePaise),
    };
    const quote = await store.deliveryQuote.create({ data: {
      customerId,
      pharmacyId: pharmacy.id,
      deliveryAddressId: address.id,
      deliveryLatitude,
      deliveryLongitude,
      distanceKm: estimate.distanceKm,
      ...money,
      estimatedDurationMinutes: estimate.durationMinutes,
      createdAt,
      expiresAt,
    }, select: { id: true, createdAt: true, expiresAt: true } });

    return {
      id: quote.id,
      pharmacyId: pharmacy.id,
      deliveryAddressId: address.id,
      distanceKm: Math.round(estimate.distanceKm * 100) / 100,
      ...money,
      estimatedDurationMinutes: estimate.durationMinutes,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
    };
}
