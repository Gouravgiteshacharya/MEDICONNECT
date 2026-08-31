import { ApiError } from "../middleware/errors.js";

interface Result { count: number; }
interface Rider { id: string; userId: string; isActive: boolean; user: { isActive: boolean }; }
interface Assignment { id: string; orderId: string; riderId: string; status: string; pickedUpAt: Date | null; deliveredAt: Date | null; order: { id: string; status: string; fulfillmentMethod: string }; }
export interface LifecycleStore {
  deliveryPartner: { findUnique(args: unknown): Promise<Rider | null>; updateMany(args: unknown): Promise<Result>; };
  deliveryAssignment: { findFirst(args: unknown): Promise<Assignment | null>; updateMany(args: unknown): Promise<Result>; };
  order: { updateMany(args: unknown): Promise<Result>; };
  deliveryEvent: { findFirst(args: unknown): Promise<{ id: string } | null>; create(args: unknown): Promise<unknown>; };
  $transaction<T>(callback: (tx: LifecycleStore) => Promise<T>, options?: unknown): Promise<T>;
}
export interface LifecycleOptions { now: () => Date; }
export type LifecycleAction = "ARRIVE_PHARMACY" | "PICKUP" | "START_DELIVERY" | "DELIVER";
const projection = { id: true, orderId: true, riderId: true, status: true, pickedUpAt: true, deliveredAt: true, order: { select: { id: true, status: true, fulfillmentMethod: true } } };
const rules = {
  PICKUP: { fromAssignment: "ACCEPTED", fromOrder: "RIDER_ASSIGNED", toAssignment: "PICKED_UP", toOrder: "PICKED_UP", eventType: "PICKED_UP", timestamp: "pickedUpAt" },
  START_DELIVERY: { fromAssignment: "PICKED_UP", fromOrder: "PICKED_UP", toAssignment: "OUT_FOR_DELIVERY", toOrder: "OUT_FOR_DELIVERY", eventType: "OUT_FOR_DELIVERY" },
  DELIVER: { fromAssignment: "OUT_FOR_DELIVERY", fromOrder: "OUT_FOR_DELIVERY", toAssignment: "DELIVERED", toOrder: "DELIVERED", eventType: "DELIVERED", timestamp: "deliveredAt" },
} as const;
function getNow(options: LifecycleOptions) { const now = options.now(); if (!Number.isFinite(now.getTime())) throw new Error("Lifecycle clock returned an invalid date"); return now; }
function isP2034(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as any).code === "P2034"; }
async function serializable<T>(store: LifecycleStore, work: (tx: LifecycleStore) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) try { return await store.$transaction(work, { isolationLevel: "Serializable" }); } catch (error) {
    if (!isP2034(error) || attempt === 3) { if (isP2034(error)) throw new ApiError(409, "Lifecycle changed concurrently", "LIFECYCLE_CONFLICT"); throw error; }
  }
  throw new ApiError(409, "Lifecycle changed concurrently", "LIFECYCLE_CONFLICT");
}
async function context(tx: LifecycleStore, userId: string, assignmentId: string) {
  const rider = await tx.deliveryPartner.findUnique({ where: { userId }, include: { user: { select: { isActive: true } } } });
  if (!rider || !rider.isActive || !rider.user.isActive) throw new ApiError(409, "Rider is inactive or unavailable", "RIDER_INACTIVE");
  const assignment = await tx.deliveryAssignment.findFirst({ where: { id: assignmentId, riderId: rider.id }, select: projection });
  if (!assignment) throw new ApiError(404, "Delivery assignment not found", "ASSIGNMENT_NOT_FOUND");
  if (assignment.order.fulfillmentMethod !== "DELIVERY") throw new ApiError(409, "Order is not a delivery order", "LIFECYCLE_NOT_ACTIONABLE");
  return { rider, assignment };
}
function safe(assignment: Assignment, manualReview = false) { return { id: assignment.id, orderId: assignment.orderId, riderId: assignment.riderId, status: assignment.status, pickedUpAt: assignment.pickedUpAt, deliveredAt: assignment.deliveredAt, orderStatus: assignment.order.status, manualReview }; }

export async function transitionLifecycle(store: LifecycleStore, userId: string, assignmentId: string, action: LifecycleAction, options: LifecycleOptions) {
  const now = getNow(options);
  return serializable(store, async (tx) => {
    const { rider, assignment } = await context(tx, userId, assignmentId);
    if (action === "ARRIVE_PHARMACY") {
      if (assignment.status !== "ACCEPTED" || assignment.order.status !== "RIDER_ASSIGNED") throw new ApiError(409, "Arrival is not actionable", "LIFECYCLE_NOT_ACTIONABLE");
      const existing = await tx.deliveryEvent.findFirst({ where: { assignmentId, eventType: "ARRIVED_AT_PHARMACY" }, select: { id: true } });
      if (!existing) await tx.deliveryEvent.create({ data: { orderId: assignment.orderId, assignmentId, riderId: rider.id, eventType: "ARRIVED_AT_PHARMACY", occurredAt: now } });
      return safe(assignment);
    }
    const rule = rules[action];
    if (assignment.status === rule.toAssignment && assignment.order.status === rule.toOrder) return safe(assignment);
    if (assignment.status !== rule.fromAssignment || assignment.order.status !== rule.fromOrder) throw new ApiError(409, "Lifecycle transition is not actionable", "LIFECYCLE_NOT_ACTIONABLE");
    const assignmentData: Record<string, unknown> = { status: rule.toAssignment };
    if ("timestamp" in rule) assignmentData[rule.timestamp] = now;
    const orderData: Record<string, unknown> = { status: rule.toOrder };
    if (action === "DELIVER") orderData.completedAt = now;
    const aw = await tx.deliveryAssignment.updateMany({ where: { id: assignment.id, riderId: rider.id, status: rule.fromAssignment }, data: assignmentData });
    const ow = await tx.order.updateMany({ where: { id: assignment.orderId, status: rule.fromOrder, fulfillmentMethod: "DELIVERY" }, data: orderData });
    if (aw.count !== 1 || ow.count !== 1) throw new ApiError(409, "Lifecycle changed concurrently", "LIFECYCLE_CONFLICT");
    if (action === "DELIVER") {
      const rw = await tx.deliveryPartner.updateMany({ where: { id: rider.id, availability: "BUSY", isActive: true }, data: { availability: "AVAILABLE" } });
      if (rw.count !== 1) throw new ApiError(409, "Rider state changed concurrently", "LIFECYCLE_CONFLICT");
    }
    await tx.deliveryEvent.create({ data: { orderId: assignment.orderId, assignmentId, riderId: rider.id, eventType: rule.eventType, occurredAt: now } });
    return safe({ ...assignment, status: rule.toAssignment, pickedUpAt: action === "PICKUP" ? now : assignment.pickedUpAt, deliveredAt: action === "DELIVER" ? now : assignment.deliveredAt, order: { ...assignment.order, status: rule.toOrder } });
  });
}

export async function failDelivery(store: LifecycleStore, userId: string, assignmentId: string, reason: string, options: LifecycleOptions) {
  const now = getNow(options);
  return serializable(store, async (tx) => {
    const { rider, assignment } = await context(tx, userId, assignmentId);
    if (!(["ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"] as string[]).includes(assignment.status)) {
      if (assignment.status === "FAILED") return safe(assignment, true);
      throw new ApiError(409, "Failed-delivery transition is not actionable", "LIFECYCLE_NOT_ACTIONABLE");
    }
    const write = await tx.deliveryAssignment.updateMany({ where: { id: assignment.id, riderId: rider.id, status: assignment.status }, data: { status: "FAILED" } });
    if (write.count !== 1) throw new ApiError(409, "Lifecycle changed concurrently", "LIFECYCLE_CONFLICT");
    const riderWrite = await tx.deliveryPartner.updateMany({ where: { id: rider.id, availability: "BUSY", isActive: true }, data: { availability: "AVAILABLE" } });
    if (riderWrite.count !== 1) throw new ApiError(409, "Rider state changed concurrently", "LIFECYCLE_CONFLICT");
    await tx.deliveryEvent.create({ data: { orderId: assignment.orderId, assignmentId, riderId: rider.id, eventType: "FAILED_DELIVERY", occurredAt: now, note: reason, metadata: { requiresManualReview: true, orderStatusAtFailure: assignment.order.status } } });
    return safe({ ...assignment, status: "FAILED" }, true);
  });
}
