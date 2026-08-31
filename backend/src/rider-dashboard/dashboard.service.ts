import { ApiError } from "../middleware/errors.js";
import { classifyLocationFreshness } from "../location/freshness.js";
import { assignmentExpiresAt, isAssignmentOfferExpired } from "../delivery-assignments/assignment.expiry.js";
export interface DashboardStore {
  deliveryPartner: { findUnique(args: unknown): Promise<any>; };
  deliveryAssignment: { findMany(args: unknown): Promise<any[]>; };
  deliveryBatch?: { findFirst(args: unknown): Promise<any>; };
}
export interface DashboardOptions { freshnessThresholdMs: number; offerTimeoutMs: number; now: () => Date; }
const activeStatuses = ["ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"];
const historyStatuses = ["DELIVERED", "FAILED", "CANCELLED", "REASSIGNED"];
const orderProjection = { id: true, orderNumber: true, status: true, deliveryAddressLabelSnapshot: true, deliveryAddressLine1Snapshot: true, deliveryLandmarkSnapshot: true, deliveryLatitudeSnapshot: true, deliveryLongitudeSnapshot: true, deliveryDistanceKm: true, quotedEtaMinutes: true, pharmacy: { select: { id: true, name: true, phone: true, addressLine1: true, latitude: true, longitude: true } } };
function operational(assignment: any, expiresAt?: Date) { return { id: assignment.id, batchId: assignment.batchId, status: assignment.status, assignedAt: assignment.assignedAt, acceptedAt: assignment.acceptedAt, pickedUpAt: assignment.pickedUpAt, deliveredAt: assignment.deliveredAt, expiresAt, order: assignment.order }; }
function nextAction(status: string) { return ({ ACCEPTED: "ARRIVE_PHARMACY_OR_PICKUP", PICKED_UP: "START_DELIVERY", OUT_FOR_DELIVERY: "DELIVER_OR_FAIL" } as Record<string, string>)[status] ?? null; }
export async function getRiderDashboard(store: DashboardStore, userId: string, options: DashboardOptions) {
  const now = options.now(); if (!Number.isFinite(now.getTime())) throw new Error("Dashboard clock returned an invalid date");
  const rider = await store.deliveryPartner.findUnique({ where: { userId }, include: { user: { select: { name: true, phone: true, isActive: true } } } });
  if (!rider) throw new ApiError(404, "Rider profile not found", "RIDER_NOT_FOUND");
  const assignments = await store.deliveryAssignment.findMany({ where: { riderId: rider.id, status: { in: ["OFFERED", ...activeStatuses, ...historyStatuses] } }, orderBy: { assignedAt: "desc" }, take: 30, select: { id: true, batchId: true, status: true, assignedAt: true, acceptedAt: true, pickedUpAt: true, deliveredAt: true, order: { select: orderProjection } } });
  const offers = assignments.filter((item) => item.status === "OFFERED" && !isAssignmentOfferExpired(item.assignedAt, now, options.offerTimeoutMs)).map((item) => operational(item, assignmentExpiresAt(item.assignedAt, options.offerTimeoutMs)));
  const active = assignments.filter((item) => activeStatuses.includes(item.status)).map((item) => ({ ...operational(item), nextAction: nextAction(item.status) }));
  const history = assignments.filter((item) => historyStatuses.includes(item.status)).slice(0, 10).map((item) => operational(item));
  const activeBatchIds = [...new Set(active.map((item) => item.batchId).filter(Boolean))];
  const activeRoute = activeBatchIds.length && store.deliveryBatch ? await store.deliveryBatch.findFirst({ where: { id: { in: activeBatchIds }, riderId: rider.id, status: "ACTIVE" }, select: { id: true, status: true, stops: { where: { status: { in: ["PENDING", "EN_ROUTE", "ARRIVED"] } }, orderBy: { sequence: "asc" }, select: { id: true, assignmentId: true, orderId: true, stopType: true, sequence: true, latitude: true, longitude: true, addressLabel: true, status: true, estimatedArrivalAt: true, assignment: { select: { order: { select: { orderNumber: true } } } } } } } }) : null;
  return {
    rider: { id: rider.id, name: rider.user.name, phone: rider.user.phone, availability: rider.availability, vehicleType: rider.vehicleType, vehicleNumber: rider.vehicleNumber, rating: rider.rating, isActive: rider.isActive && rider.user.isActive },
    location: { freshness: classifyLocationFreshness(rider.lastLocationAt, { now, freshForMs: options.freshnessThresholdMs }), lastUpdatedAt: rider.lastLocationAt, sharing: rider.lastLocationAt !== null },
    workload: { actionableOffers: offers.length, activeAssignments: active.length, recentDeliveries: history.filter((item) => item.status === "DELIVERED").length },
    offers, activeAssignments: active, activeRoute: activeRoute ? { batchId: activeRoute.id, status: activeRoute.status, stops: activeRoute.stops.map((stop: any) => ({ id: stop.id, assignmentId: stop.assignmentId, orderId: stop.orderId, orderNumber: stop.assignment?.order?.orderNumber ?? null, stopType: stop.stopType, sequence: stop.sequence, latitude: stop.latitude, longitude: stop.longitude, addressLabel: stop.addressLabel, status: stop.status, estimatedArrivalAt: stop.estimatedArrivalAt })) } : null, recentHistory: history,
  };
}
