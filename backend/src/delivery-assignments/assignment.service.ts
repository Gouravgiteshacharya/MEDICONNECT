import { ApiError } from "../middleware/errors.js";
import { classifyLocationFreshness } from "../location/freshness.js";
import { validateCoordinates } from "../location/coordinates.js";
import type { AssignmentConfig } from "./assignment.config.js";
import { assignmentExpiresAt, isAssignmentOfferExpired } from "./assignment.expiry.js";
import type { CreateOfferInput } from "./assignment.validation.js";

export const LIVE_ASSIGNMENT_STATUSES = ["OFFERED", "ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"] as const;

interface Rider { id: string; userId: string; availability: string; isActive: boolean; currentLatitude: number | null; currentLongitude: number | null; lastLocationAt: Date | null; user: { isActive: boolean }; }
interface Order { id: string; orderNumber: string; fulfillmentMethod: string; status: string; pharmacyId: string; pharmacy?: unknown; }
interface Assignment {
  id: string; orderId: string; riderId: string; status: string; assignedAt: Date;
  acceptedAt?: Date | null; declinedAt?: Date | null; timedOutAt?: Date | null; order: Order;
}
interface WriteResult { count: number; }

export interface AssignmentStore {
  deliveryPartner: {
    findUnique(args: unknown): Promise<Rider | null>;
    updateMany(args: unknown): Promise<WriteResult>;
  };
  order: {
    findUnique(args: unknown): Promise<Order | null>;
    updateMany(args: unknown): Promise<WriteResult>;
  };
  deliveryAssignment: {
    findFirst(args: unknown): Promise<Assignment | null>;
    findMany(args: unknown): Promise<Assignment[]>;
    create(args: unknown): Promise<Assignment>;
    updateMany(args: unknown): Promise<WriteResult>;
  };
  deliveryEvent: { createMany(args: unknown): Promise<WriteResult>; };
  dispatchAttempt?: { updateMany(args: unknown): Promise<WriteResult>; };
  $transaction<T>(callback: (transaction: AssignmentStore) => Promise<T>, options?: unknown): Promise<T>;
}

export interface AssignmentOptions extends AssignmentConfig { freshnessThresholdMs: number; now: () => Date; }
const SERIALIZABLE_RETRY_LIMIT = 3;
const offerProjection = {
  id: true, orderId: true, riderId: true, status: true, assignedAt: true, acceptedAt: true, declinedAt: true, timedOutAt: true,
  order: { select: { id: true, orderNumber: true, fulfillmentMethod: true, status: true, pharmacyId: true,
    deliveryAddressLabelSnapshot: true, deliveryLatitudeSnapshot: true, deliveryLongitudeSnapshot: true,
    deliveryDistanceKm: true, quotedEtaMinutes: true,
    pharmacy: { select: { id: true, name: true, latitude: true, longitude: true } },
  } },
};

function nowFrom(options: AssignmentOptions): Date {
  const now = options.now();
  if (!Number.isFinite(now.getTime())) throw new Error("Assignment clock returned an invalid date");
  return now;
}
function project(assignment: Assignment, timeoutMs: number) {
  return { ...assignment, expiresAt: assignmentExpiresAt(assignment.assignedAt, timeoutMs) };
}

function isSerializationConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2034";
}
async function serializable<T>(store: AssignmentStore, callback: (tx: AssignmentStore) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try { return await store.$transaction(callback, { isolationLevel: "Serializable" }); }
    catch (error) {
      if (!isSerializationConflict(error) || attempt === SERIALIZABLE_RETRY_LIMIT) {
        if (isSerializationConflict(error)) throw new ApiError(409, "Assignment changed concurrently", "ASSIGNMENT_ACCEPTANCE_CONFLICT");
        throw error;
      }
    }
  }
  throw new ApiError(409, "Assignment changed concurrently", "ASSIGNMENT_ACCEPTANCE_CONFLICT");
}

export async function createAssignmentOffer(store: AssignmentStore, input: CreateOfferInput, options: AssignmentOptions) {
  const now = nowFrom(options);
  return serializable(store, async (tx) => {
    const order = await tx.order.findUnique({ where: { id: input.orderId }, select: { id: true, orderNumber: true, fulfillmentMethod: true, status: true, pharmacyId: true } });
    if (!order) throw new ApiError(404, "Order not found", "ORDER_NOT_FOUND");
    if (order.fulfillmentMethod !== "DELIVERY" || order.status !== "READY_FOR_PICKUP") throw new ApiError(409, "Order is not eligible for assignment", "ORDER_NOT_ELIGIBLE");
    const rider = await tx.deliveryPartner.findUnique({ where: { id: input.riderId }, include: { user: { select: { isActive: true } } } });
    if (!rider) throw new ApiError(404, "Rider not found", "RIDER_NOT_FOUND");
    if (!rider.isActive || !rider.user.isActive) throw new ApiError(409, "Rider is inactive", "RIDER_INACTIVE");
    if (rider.availability !== "AVAILABLE") throw new ApiError(409, "Rider is unavailable", "RIDER_UNAVAILABLE");
    if (rider.currentLatitude === null || rider.currentLongitude === null) throw new ApiError(409, "Rider location is unavailable", "RIDER_LOCATION_UNAVAILABLE");
    try { validateCoordinates({ latitude: rider.currentLatitude, longitude: rider.currentLongitude }); }
    catch { throw new ApiError(409, "Rider location is unavailable", "RIDER_LOCATION_UNAVAILABLE"); }
    const freshness = classifyLocationFreshness(rider.lastLocationAt, { now, freshForMs: options.freshnessThresholdMs });
    if (freshness === "UNAVAILABLE") throw new ApiError(409, "Rider location is unavailable", "RIDER_LOCATION_UNAVAILABLE");
    if (freshness === "STALE") throw new ApiError(409, "Rider location is stale", "RIDER_LOCATION_STALE");
    const live = await tx.deliveryAssignment.findFirst({ where: { orderId: order.id, status: { in: LIVE_ASSIGNMENT_STATUSES } }, select: { id: true } });
    if (live) throw new ApiError(409, "A live assignment already exists", "LIVE_ASSIGNMENT_EXISTS");
    const created = await tx.deliveryAssignment.create({ data: { orderId: order.id, riderId: rider.id, status: "OFFERED", assignedAt: now }, select: offerProjection });
    return project(created, options.offerTimeoutMs);
  });
}

async function riderForUser(tx: AssignmentStore, userId: string): Promise<Rider> {
  const rider = await tx.deliveryPartner.findUnique({ where: { userId }, include: { user: { select: { isActive: true } } } });
  if (!rider) throw new ApiError(404, "Rider profile not found", "RIDER_NOT_FOUND");
  return rider;
}

export async function listMyOffers(store: AssignmentStore, userId: string, options: AssignmentOptions) {
  const now = nowFrom(options);
  return serializable(store, async (tx) => {
    const rider = await riderForUser(tx, userId);
    const offers = await tx.deliveryAssignment.findMany({ where: { riderId: rider.id, status: "OFFERED" }, select: offerProjection, orderBy: { assignedAt: "asc" } });
    const actionable: Assignment[] = [];
    for (const offer of offers) {
      if (isAssignmentOfferExpired(offer.assignedAt, now, options.offerTimeoutMs)) {
        await tx.deliveryAssignment.updateMany({ where: { id: offer.id, riderId: rider.id, status: "OFFERED" }, data: { status: "TIMED_OUT", timedOutAt: now } });
        await tx.dispatchAttempt?.updateMany({ where: { assignmentId: offer.id, status: "OFFERED" }, data: { status: "TIMED_OUT" } });
      } else actionable.push(offer);
    }
    return actionable.map((offer) => project(offer, options.offerTimeoutMs));
  });
}

export async function acceptAssignmentOffer(store: AssignmentStore, userId: string, assignmentId: string, options: AssignmentOptions) {
  const now = nowFrom(options);
  const outcome = await serializable(store, async (tx) => {
    const rider = await riderForUser(tx, userId);
    const assignment = await tx.deliveryAssignment.findFirst({ where: { id: assignmentId, riderId: rider.id }, select: offerProjection });
    if (!assignment) throw new ApiError(404, "Assignment offer not found", "OFFER_NOT_FOUND");
    if (assignment.status !== "OFFERED") throw new ApiError(409, "Assignment offer is not actionable", "OFFER_NOT_ACTIONABLE");
    if (isAssignmentOfferExpired(assignment.assignedAt, now, options.offerTimeoutMs)) {
      await tx.deliveryAssignment.updateMany({ where: { id: assignment.id, riderId: rider.id, status: "OFFERED" }, data: { status: "TIMED_OUT", timedOutAt: now } });
      await tx.dispatchAttempt?.updateMany({ where: { assignmentId: assignment.id, status: "OFFERED" }, data: { status: "TIMED_OUT" } });
      return { kind: "expired" as const };
    }
    if (!rider.isActive || !rider.user.isActive) throw new ApiError(409, "Rider is inactive", "RIDER_INACTIVE");
    if (rider.availability !== "AVAILABLE") throw new ApiError(409, "Rider is unavailable", "RIDER_UNAVAILABLE");
    if (assignment.order.fulfillmentMethod !== "DELIVERY" || assignment.order.status !== "READY_FOR_PICKUP") throw new ApiError(409, "Order is not eligible for assignment", "ORDER_NOT_ELIGIBLE");
    const competing = await tx.deliveryAssignment.findFirst({ where: { orderId: assignment.orderId, id: { not: assignment.id }, status: { in: ["ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"] } }, select: { id: true } });
    if (competing) return { kind: "conflict" as const };
    const assignmentWrite = await tx.deliveryAssignment.updateMany({ where: { id: assignment.id, riderId: rider.id, status: "OFFERED" }, data: { status: "ACCEPTED", acceptedAt: now } });
    const orderWrite = await tx.order.updateMany({ where: { id: assignment.orderId, status: "READY_FOR_PICKUP", fulfillmentMethod: "DELIVERY" }, data: { status: "RIDER_ASSIGNED" } });
    const riderWrite = await tx.deliveryPartner.updateMany({ where: { id: rider.id, availability: "AVAILABLE", isActive: true, user: { isActive: true } }, data: { availability: "BUSY" } });
    if (assignmentWrite.count !== 1 || orderWrite.count !== 1 || riderWrite.count !== 1) throw new ApiError(409, "Assignment acceptance conflicted with another update", "ASSIGNMENT_ACCEPTANCE_CONFLICT");
    await tx.deliveryEvent.createMany({ data: [
      { orderId: assignment.orderId, assignmentId: assignment.id, riderId: rider.id, eventType: "RIDER_ASSIGNED", occurredAt: now },
      { orderId: assignment.orderId, assignmentId: assignment.id, riderId: rider.id, eventType: "RIDER_ACCEPTED", occurredAt: now },
    ] });
    await tx.dispatchAttempt?.updateMany({ where: { assignmentId: assignment.id, status: "OFFERED" }, data: { status: "ACCEPTED" } });
    return { kind: "accepted" as const, assignment: { ...assignment, status: "ACCEPTED", acceptedAt: now, order: { ...assignment.order, status: "RIDER_ASSIGNED" } } };
  });
  if (outcome.kind === "expired") throw new ApiError(409, "Assignment offer has expired", "OFFER_EXPIRED");
  if (outcome.kind === "conflict") throw new ApiError(409, "Another assignment already won", "ASSIGNMENT_ACCEPTANCE_CONFLICT");
  return project(outcome.assignment, options.offerTimeoutMs);
}

export async function declineAssignmentOffer(store: AssignmentStore, userId: string, assignmentId: string, options: AssignmentOptions) {
  const now = nowFrom(options);
  const outcome = await serializable(store, async (tx) => {
    const rider = await riderForUser(tx, userId);
    const assignment = await tx.deliveryAssignment.findFirst({ where: { id: assignmentId, riderId: rider.id }, select: offerProjection });
    if (!assignment) throw new ApiError(404, "Assignment offer not found", "OFFER_NOT_FOUND");
    if (assignment.status !== "OFFERED") throw new ApiError(409, "Assignment offer is not actionable", "OFFER_NOT_ACTIONABLE");
    if (isAssignmentOfferExpired(assignment.assignedAt, now, options.offerTimeoutMs)) {
      await tx.deliveryAssignment.updateMany({ where: { id: assignment.id, riderId: rider.id, status: "OFFERED" }, data: { status: "TIMED_OUT", timedOutAt: now } });
      await tx.dispatchAttempt?.updateMany({ where: { assignmentId: assignment.id, status: "OFFERED" }, data: { status: "TIMED_OUT" } });
      return { kind: "expired" as const };
    }
    const write = await tx.deliveryAssignment.updateMany({ where: { id: assignment.id, riderId: rider.id, status: "OFFERED" }, data: { status: "DECLINED", declinedAt: now } });
    if (write.count !== 1) throw new ApiError(409, "Assignment offer changed concurrently", "OFFER_NOT_ACTIONABLE");
    await tx.dispatchAttempt?.updateMany({ where: { assignmentId: assignment.id, status: "OFFERED" }, data: { status: "DECLINED" } });
    return { kind: "declined" as const, assignment: { ...assignment, status: "DECLINED", declinedAt: now } };
  });
  if (outcome.kind === "expired") throw new ApiError(409, "Assignment offer has expired", "OFFER_EXPIRED");
  return project(outcome.assignment, options.offerTimeoutMs);
}
