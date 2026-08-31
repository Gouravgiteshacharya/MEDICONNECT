import { ApiError } from "../middleware/errors.js";
import { haversineDistanceKm, validateCoordinates } from "../location/coordinates.js";
import { classifyLocationFreshness } from "../location/freshness.js";
import type { BatchConfig } from "./batch.config.js";
export interface BatchStore {
  deliveryPartner: { findUnique(args: unknown): Promise<any>; };
  deliveryAssignment: { findFirst(args: unknown): Promise<any>; updateMany(args: unknown): Promise<{ count: number }>; create(args: unknown): Promise<any>; };
  order: { findUnique(args: unknown): Promise<any>; };
  deliveryBatch: { findFirst(args: unknown): Promise<any>; create(args: unknown): Promise<any>; };
  deliveryStop: { createMany(args: unknown): Promise<{ count: number }>; };
  $transaction<T>(callback: (tx: BatchStore) => Promise<T>, options?: unknown): Promise<T>;
}
export interface BatchOptions extends BatchConfig { freshnessThresholdMs: number; now: () => Date; }
const orderSelect = { id: true, orderNumber: true, status: true, fulfillmentMethod: true, deliveryLatitudeSnapshot: true, deliveryLongitudeSnapshot: true, quotedEtaMinutes: true, pharmacy: { select: { id: true, name: true, latitude: true, longitude: true } } };
function point(latitude: unknown, longitude: unknown, code: string) { const value = { latitude: latitude as number, longitude: longitude as number }; try { validateCoordinates(value); return value; } catch { throw new ApiError(422, "Required batch coordinates are unavailable", code); } }
function p2034(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as any).code === "P2034"; }
export async function createCompatibleBatch(store: BatchStore, input: { riderId: string; candidateOrderId: string }, options: BatchOptions) {
  for (let attempt = 1; attempt <= 3; attempt += 1) try { return await store.$transaction(async (tx) => {
    const now = options.now(); if (!Number.isFinite(now.getTime())) throw new Error("Batch clock returned an invalid date");
    const rider = await tx.deliveryPartner.findUnique({ where: { id: input.riderId }, include: { user: { select: { isActive: true } } } });
    if (!rider || !rider.isActive || !rider.user.isActive || rider.availability !== "BUSY") throw new ApiError(409, "Rider is not eligible for batching", "RIDER_NOT_BATCH_ELIGIBLE");
    if (classifyLocationFreshness(rider.lastLocationAt, { now, freshForMs: options.freshnessThresholdMs }) !== "FRESH") throw new ApiError(409, "Rider location is not fresh", "RIDER_LOCATION_STALE");
    point(rider.currentLatitude, rider.currentLongitude, "RIDER_LOCATION_UNAVAILABLE");
    const existingBatch = await tx.deliveryBatch.findFirst({ where: { riderId: rider.id, status: { in: ["PLANNED", "ACTIVE"] } }, select: { id: true, _count: { select: { assignments: true } } } });
    if (existingBatch) throw new ApiError(409, "Rider already has a batch", "BATCH_CAPACITY_REACHED");
    const primary = await tx.deliveryAssignment.findFirst({ where: { riderId: rider.id, status: { in: ["ACCEPTED", "PICKED_UP"] }, batchId: null }, select: { id: true, status: true, order: { select: orderSelect } } });
    if (!primary) throw new ApiError(409, "Rider has no batch-compatible active assignment", "PRIMARY_ASSIGNMENT_NOT_ELIGIBLE");
    const candidate = await tx.order.findUnique({ where: { id: input.candidateOrderId }, select: orderSelect });
    if (!candidate) throw new ApiError(404, "Candidate order not found", "ORDER_NOT_FOUND");
    if (candidate.id === primary.order.id || candidate.fulfillmentMethod !== "DELIVERY" || candidate.status !== "READY_FOR_PICKUP") throw new ApiError(409, "Candidate order is not ready for batching", "CANDIDATE_ORDER_NOT_ELIGIBLE");
    const candidateLive = await tx.deliveryAssignment.findFirst({ where: { orderId: candidate.id, status: { in: ["OFFERED", "ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"] } }, select: { id: true } });
    if (candidateLive) throw new ApiError(409, "Candidate order already has a live assignment", "CANDIDATE_ALREADY_ASSIGNED");
    const primaryPickup = point(primary.order.pharmacy.latitude, primary.order.pharmacy.longitude, "PRIMARY_COORDINATES_UNAVAILABLE"), candidatePickup = point(candidate.pharmacy.latitude, candidate.pharmacy.longitude, "CANDIDATE_COORDINATES_UNAVAILABLE"), primaryDrop = point(primary.order.deliveryLatitudeSnapshot, primary.order.deliveryLongitudeSnapshot, "PRIMARY_COORDINATES_UNAVAILABLE"), candidateDrop = point(candidate.deliveryLatitudeSnapshot, candidate.deliveryLongitudeSnapshot, "CANDIDATE_COORDINATES_UNAVAILABLE");
    const pharmacySeparationKm = haversineDistanceKm(primaryPickup, candidatePickup), dropoffSeparationKm = haversineDistanceKm(primaryDrop, candidateDrop);
    if (pharmacySeparationKm > options.maxPharmacySeparationKm || dropoffSeparationKm > options.maxDropoffSeparationKm) throw new ApiError(409, "Orders are not geographically compatible", "ORDERS_NOT_BATCH_COMPATIBLE");
    if (primary.order.quotedEtaMinutes === null || candidate.quotedEtaMinutes === null) throw new ApiError(409, "Both orders require promised ETAs for batching", "BATCH_ETA_UNAVAILABLE");
    const estimatedDetourMinutes = (pharmacySeparationKm + dropoffSeparationKm) / options.assumedSpeedKmh * 60;
    if (estimatedDetourMinutes > options.maxEstimatedDetourMinutes) throw new ApiError(409, "Estimated batch detour exceeds the configured limit", "BATCH_DETOUR_TOO_HIGH");
    const batch = await tx.deliveryBatch.create({ data: { riderId: rider.id, status: "PLANNED" }, select: { id: true, riderId: true, status: true, createdAt: true } });
    const attached = await tx.deliveryAssignment.updateMany({ where: { id: primary.id, riderId: rider.id, batchId: null, status: primary.status }, data: { batchId: batch.id } });
    if (attached.count !== 1) throw new ApiError(409, "Primary assignment changed concurrently", "BATCH_CONFLICT");
    const offer = await tx.deliveryAssignment.create({ data: { orderId: candidate.id, riderId: rider.id, batchId: batch.id, status: "OFFERED", assignmentScore: pharmacySeparationKm + dropoffSeparationKm, assignedAt: now }, select: { id: true, orderId: true, riderId: true, batchId: true, status: true, assignedAt: true } });
    const stops = primary.status === "ACCEPTED" ? [
      ["PHARMACY_PICKUP", primaryPickup, primary.id, primary.order.id, primary.order.pharmacy.name], ["PHARMACY_PICKUP", candidatePickup, offer.id, candidate.id, candidate.pharmacy.name], ["CUSTOMER_DROPOFF", primaryDrop, primary.id, primary.order.id, "Primary customer"], ["CUSTOMER_DROPOFF", candidateDrop, offer.id, candidate.id, "Candidate customer"],
    ] : [["PHARMACY_PICKUP", candidatePickup, offer.id, candidate.id, candidate.pharmacy.name], ["CUSTOMER_DROPOFF", primaryDrop, primary.id, primary.order.id, "Primary customer"], ["CUSTOMER_DROPOFF", candidateDrop, offer.id, candidate.id, "Candidate customer"]];
    await tx.deliveryStop.createMany({ data: stops.map(([stopType, coordinates, assignmentId, orderId, addressLabel], index) => ({ batchId: batch.id, assignmentId, orderId, stopType, sequence: index + 1, latitude: (coordinates as any).latitude, longitude: (coordinates as any).longitude, addressLabel, status: "PENDING" })) });
    return { batch, offer, compatibility: { pharmacySeparationKm: Math.round(pharmacySeparationKm * 100) / 100, dropoffSeparationKm: Math.round(dropoffSeparationKm * 100) / 100, estimatedDetourMinutes: Math.ceil(estimatedDetourMinutes) }, stopCount: stops.length };
  }, { isolationLevel: "Serializable" }); } catch (error) { if (!p2034(error) || attempt === 3) { if (p2034(error)) throw new ApiError(409, "Batch changed concurrently", "BATCH_CONFLICT"); throw error; } }
  throw new ApiError(409, "Batch changed concurrently", "BATCH_CONFLICT");
}
