import { ApiError } from "../middleware/errors.js";
import type { RiderStore } from "../riders/rider.service.js";
import type { DeliveryQuoteConfig } from "./delivery-quote.config.js";
import { paiseToRupees } from "./delivery-quote.config.js";
import type { DeliveryQuoteInput } from "./delivery-quote.validation.js";
import type { DistanceProvider } from "./distance-provider.js";
import { calculateDeliveryPrice } from "./pricing.js";
import { validateCoordinates } from "../location/coordinates.js";
import { ACTIVE_DEMAND_ORDER_STATUSES, calculateDemandSignal } from "./demand-pricing.js";
import { isPeakHour, type LogisticsModel } from "../ml/logistics-model.js";

interface CustomerRecord { id: string; isActive: boolean; }
interface AddressRecord { id: string; userId: string; latitude: number | null; longitude: number | null; }
interface PharmacyRecord {
  id: string; latitude: number | null; longitude: number | null;
  isActive: boolean; isVerified: boolean; partnerStatus: string;
}
interface CreatedQuote { id: string; createdAt: Date; expiresAt: Date | null; }

export interface DeliveryQuoteStore extends RiderStore {
  deliveryPartner: RiderStore["deliveryPartner"] & { count(args: unknown): Promise<number>; };
  order: { count(args: unknown): Promise<number>; };
  user: { findFirst(args: unknown): Promise<CustomerRecord | null>; };
  address: { findFirst(args: unknown): Promise<AddressRecord | null>; };
  pharmacy: { findUnique(args: unknown): Promise<PharmacyRecord | null>; };
  deliveryQuote: { create(args: unknown): Promise<CreatedQuote>; };
}
export interface DeliveryQuoteServiceOptions {
  config: DeliveryQuoteConfig;
  distanceProvider: DistanceProvider;
  now: () => Date;
  freshnessThresholdMs: number;
  mlModel: LogisticsModel | null;
  maxPredictionMinutes: number;
  fallbackSpeedKmh: number;
  timezoneOffsetMinutes: number;
}

export async function createDeliveryQuote(
  store: DeliveryQuoteStore,
  customerId: string,
  input: DeliveryQuoteInput,
  options: DeliveryQuoteServiceOptions,
) {
  const createdAt = options.now();
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Quote clock returned an invalid date");
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

    const demand = options.config.demand ? calculateDemandSignal(
      await transaction.order.count({ where: { fulfillmentMethod: "DELIVERY", status: { in: ACTIVE_DEMAND_ORDER_STATUSES } } }),
      await transaction.deliveryPartner.count({ where: { availability: "AVAILABLE", isActive: true, user: { isActive: true }, lastLocationAt: { gte: new Date(createdAt.getTime() - options.freshnessThresholdMs) } } }),
      options.config.demand,
    ) : calculateDemandSignal(0, 0);
    return { address, pharmacy, demand };
  });
  const { address, pharmacy, demand } = eligibility;
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

    const pricing = calculateDeliveryPrice(estimate.distanceKm, options.config, demand.multiplierBps);
    const deterministicMinutes = estimate.durationMinutes ?? Math.ceil(estimate.distanceKm / options.fallbackSpeedKmh * 60);
    let estimatedDurationMinutes = deterministicMinutes, etaMode: "ML_ASSISTED" | "DETERMINISTIC_FALLBACK" = "DETERMINISTIC_FALLBACK", etaModelVersion: string | null = null;
    if (options.mlModel) try {
      const workload = demand.orderToRiderRatio === null ? 4 : Math.min(4, demand.orderToRiderRatio), prediction = options.mlModel.predictEta({ riderDistanceKm: 0, workload, customerDistanceKm: Math.max(0.5, estimate.distanceKm), peakHour: isPeakHour(createdAt, options.timezoneOffsetMinutes), batched: 0 });
      if (!Number.isFinite(prediction.predictedCompletionMinutes) || prediction.predictedCompletionMinutes <= 0 || prediction.predictedCompletionMinutes > options.maxPredictionMinutes) throw new Error("Invalid ML ETA prediction");
      estimatedDurationMinutes = Math.ceil(prediction.predictedCompletionMinutes); etaMode = "ML_ASSISTED"; etaModelVersion = prediction.modelVersion;
    } catch { /* provider duration remains the deterministic fallback */ }
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
      estimatedDurationMinutes,
      createdAt,
      expiresAt,
    }, select: { id: true, createdAt: true, expiresAt: true } });

    return {
      id: quote.id,
      pharmacyId: pharmacy.id,
      deliveryAddressId: address.id,
      distanceKm: Math.round(estimate.distanceKm * 100) / 100,
      ...money,
      demand: { activeOrders: demand.activeOrders, availableRiders: demand.availableRiders, orderToRiderRatio: demand.orderToRiderRatio === null ? null : Math.round(demand.orderToRiderRatio * 100) / 100, tier: demand.tier },
      estimatedDurationMinutes,
      etaAssistance: { mode: etaMode, modelVersion: etaModelVersion, deterministicMinutes, predictedMinutes: etaMode === "ML_ASSISTED" ? estimatedDurationMinutes : null },
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
    };
}
