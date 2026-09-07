import type { DeliveryPartnerAvailability } from "../../generated/prisma/client.js";
import { ApiError } from "../utils/ApiError.js";
export const MANUAL_AVAILABILITIES = ["AVAILABLE", "OFFLINE", "PAUSED"] as const;
export type ManualAvailability = (typeof MANUAL_AVAILABILITIES)[number];
interface RiderRecord {
  id: string; userId: string; availability: DeliveryPartnerAvailability; vehicleType: string;
  vehicleNumber: string | null; rating: unknown; isActive: boolean; createdAt: Date; updatedAt: Date;
  user: { id: string; name: string; email: string; phone: string | null; isActive: boolean };
}
export interface RiderStore {
  deliveryPartner: {
    findUnique(args: any): Promise<RiderRecord | null>;
    update(args: any): Promise<RiderRecord>;
  };
  $transaction<T>(callback: (transaction: RiderStore) => Promise<T>, options?: unknown): Promise<T>;
}
const riderSelection = { include: { user: { select: { id: true, name: true, email: true, phone: true, isActive: true } } } };
export async function getRiderProfile(store: RiderStore, userId: string): Promise<RiderRecord> {
  const rider = await store.deliveryPartner.findUnique({ where: { userId }, ...riderSelection });
  if (!rider) throw new ApiError(404, "Rider profile not found", "RIDER_NOT_FOUND");
  if (rider.userId !== userId) throw new ApiError(403, "Rider profile ownership mismatch", "FORBIDDEN");
  return rider;
}
export async function setRiderAvailability(store: RiderStore, userId: string, availability: ManualAvailability): Promise<RiderRecord> {
  return store.$transaction(async (transaction) => {
    const rider = await getRiderProfile(transaction, userId);
    if (rider.availability === "BUSY") throw new ApiError(409, "Availability cannot be changed during an active delivery", "RIDER_BUSY");
    if (availability === "AVAILABLE" && (!rider.isActive || !rider.user.isActive)) {
      throw new ApiError(409, "Inactive riders cannot become available", "RIDER_INACTIVE");
    }
    return transaction.deliveryPartner.update({ where: { id: rider.id }, data: { availability }, ...riderSelection });
  });
}
