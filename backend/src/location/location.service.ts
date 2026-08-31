import type { RiderStore } from "../riders/rider.service.js";
import { getRiderProfile } from "../riders/rider.service.js";
import { ApiError } from "../middleware/errors.js";
import type { LocationInput } from "./location.validation.js";

interface LatestLocation { recordedAt: Date; }
export interface LocationStore extends RiderStore {
  deliveryAssignment: { findFirst(args: unknown): Promise<{ id: string; batchId: string | null } | null>; };
  deliveryBatch: { findFirst(args: unknown): Promise<{ id: string } | null>; };
  locationUpdate: {
    findFirst(args: unknown): Promise<LatestLocation | null>;
    create(args: unknown): Promise<unknown>;
  };
}
export interface UpdateLocationOptions { sampleIntervalMs: number; now: () => Date; }

export async function updateRiderLocation(
  store: LocationStore,
  userId: string,
  input: LocationInput,
  options: UpdateLocationOptions,
) {
  return store.$transaction(async (baseTransaction) => {
    const transaction = baseTransaction as LocationStore;
    const rider = await getRiderProfile(transaction, userId);
    if (!rider.isActive || !rider.user.isActive) throw new ApiError(409, "Inactive riders cannot update location", "RIDER_INACTIVE");

    let assignment: { id: string; batchId: string | null } | null = null;
    if (input.assignmentId) {
      assignment = await transaction.deliveryAssignment.findFirst({
        where: { id: input.assignmentId, riderId: rider.id, status: { in: ["OFFERED", "ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"] } },
        select: { id: true, batchId: true },
      });
      if (!assignment) throw new ApiError(403, "Assignment does not belong to the authenticated rider", "ASSIGNMENT_NOT_OWNED");
    }
    if (input.batchId) {
      const batch = await transaction.deliveryBatch.findFirst({ where: { id: input.batchId, riderId: rider.id, status: { in: ["PLANNED", "ACTIVE"] } }, select: { id: true } });
      if (!batch) throw new ApiError(403, "Batch does not belong to the authenticated rider", "BATCH_NOT_OWNED");
    }
    if (assignment && input.batchId && assignment.batchId !== input.batchId) {
      throw new ApiError(409, "Assignment is not attached to the supplied batch", "ASSIGNMENT_BATCH_MISMATCH");
    }

    const now = options.now();
    if (!Number.isFinite(now.getTime())) throw new Error("Location clock returned an invalid date");
    const latest = await transaction.locationUpdate.findFirst({
      where: { riderId: rider.id }, orderBy: { recordedAt: "desc" }, select: { recordedAt: true },
    });
    const historyRecorded = !latest || now.getTime() - latest.recordedAt.getTime() >= options.sampleIntervalMs;

    const updatedRider = await transaction.deliveryPartner.update({
      where: { id: rider.id },
      data: { currentLatitude: input.latitude, currentLongitude: input.longitude, lastLocationAt: now },
      include: { user: { select: { id: true, name: true, email: true, phone: true, isActive: true } } },
    });
    if (historyRecorded) {
      await transaction.locationUpdate.create({ data: {
        riderId: rider.id,
        assignmentId: input.assignmentId,
        batchId: input.batchId,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyMeters: input.accuracyMeters,
        recordedAt: now,
      } });
    }
    return { rider: updatedRider, historyRecorded };
  }, { isolationLevel: "Serializable" });
}
