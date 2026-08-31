import { ApiError } from "../middleware/errors.js";
import { haversineDistanceKm, validateCoordinates } from "../location/coordinates.js";
import { classifyLocationFreshness } from "../location/freshness.js";

interface TrackingStore { order: { findFirst(args: unknown): Promise<any>; }; }
export type { TrackingStore };
export interface TrackingOptions { freshnessThresholdMs: number; now: () => Date; }
const terminalStatuses = new Set(["DELIVERED", "CANCELLED", "REJECTED_BY_PHARMACY"]);
const assignmentStatuses = ["ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED"];

export async function getCustomerTracking(store: TrackingStore, customerId: string, orderId: string, options: TrackingOptions) {
  const now = options.now(); if (!Number.isFinite(now.getTime())) throw new Error("Tracking clock returned an invalid date");
  const order = await store.order.findFirst({
    where: { id: orderId, customerId },
    select: {
      id: true, orderNumber: true, status: true, fulfillmentMethod: true, quotedEtaMinutes: true,
      deliveryLatitudeSnapshot: true, deliveryLongitudeSnapshot: true,
      deliveryAssignments: { where: { status: { in: assignmentStatuses } }, orderBy: { assignedAt: "desc" }, take: 1,
        select: { id: true, status: true, assignedAt: true, acceptedAt: true, pickedUpAt: true, deliveredAt: true,
          rider: { select: { id: true, currentLatitude: true, currentLongitude: true, lastLocationAt: true, user: { select: { name: true, phone: true } } } },
        },
      },
      deliveryEvents: { orderBy: { occurredAt: "asc" }, select: { eventType: true, occurredAt: true } },
    },
  });
  if (!order) throw new ApiError(404, "Order not found", "ORDER_NOT_FOUND");
  if (order.fulfillmentMethod !== "DELIVERY") throw new ApiError(409, "Tracking is unavailable for self-pickup orders", "TRACKING_NOT_AVAILABLE");
  const assignment = order.deliveryAssignments[0] ?? null;
  const terminal = terminalStatuses.has(order.status);
  const locationSharingEnded = terminal || assignment?.status === "FAILED";
  let locationFreshness: "FRESH" | "STALE" | "UNAVAILABLE" = "UNAVAILABLE";
  let location: { latitude: number; longitude: number } | null = null;
  let remainingDistanceKm: number | null = null;
  let lastUpdatedAt: Date | null = null;
  if (assignment) {
    const rider = assignment.rider;
    locationFreshness = classifyLocationFreshness(rider.lastLocationAt, { now, freshForMs: options.freshnessThresholdMs });
    lastUpdatedAt = rider.lastLocationAt;
    if (!locationSharingEnded && locationFreshness === "FRESH" && rider.currentLatitude !== null && rider.currentLongitude !== null) {
      try {
        validateCoordinates({ latitude: rider.currentLatitude, longitude: rider.currentLongitude });
        location = { latitude: rider.currentLatitude, longitude: rider.currentLongitude };
        if (order.deliveryLatitudeSnapshot !== null && order.deliveryLongitudeSnapshot !== null) {
          try {
            validateCoordinates({ latitude: order.deliveryLatitudeSnapshot, longitude: order.deliveryLongitudeSnapshot });
            remainingDistanceKm = Math.round(haversineDistanceKm(location, { latitude: order.deliveryLatitudeSnapshot, longitude: order.deliveryLongitudeSnapshot }) * 100) / 100;
          } catch { remainingDistanceKm = null; }
        }
      } catch { locationFreshness = "UNAVAILABLE"; location = null; remainingDistanceKm = null; }
    }
  }
  return {
    orderId: order.id, orderNumber: order.orderNumber, status: order.status, terminal,
    quotedEtaMinutes: order.quotedEtaMinutes,
    assignment: assignment ? { id: assignment.id, status: assignment.status, assignedAt: assignment.assignedAt, acceptedAt: assignment.acceptedAt, pickedUpAt: assignment.pickedUpAt, deliveredAt: assignment.deliveredAt } : null,
    rider: assignment ? { name: assignment.rider.user.name, phone: locationSharingEnded ? null : assignment.rider.user.phone } : null,
    location: locationSharingEnded ? null : location,
    locationFreshness: locationSharingEnded ? "UNAVAILABLE" : locationFreshness,
    remainingDistanceKm: locationSharingEnded ? null : remainingDistanceKm,
    lastUpdatedAt: locationSharingEnded ? null : lastUpdatedAt,
    timeline: order.deliveryEvents.map((event: any) => ({ eventType: event.eventType, occurredAt: event.occurredAt })),
  };
}
