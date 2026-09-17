import { z } from "zod";
import { OrderStatus, FulfillmentMethod, PrescriptionStatus } from "../../generated/prisma/client.js";
import { InventoryManagementMode, InventoryStatus, PharmacyPartnerStatus } from "../../generated/prisma/client.js";
import { uuidSchema } from "./common.schemas.js";

const pagination = {
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: uuidSchema.optional(),
};
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
export const adminPharmacyListSchema = z.object({
  ...pagination,
  isActive: booleanQuery.optional(),
  isVerified: booleanQuery.optional(),
  partnerStatus: z.enum(PharmacyPartnerStatus).optional(),
  inventoryManagementMode: z.enum(InventoryManagementMode).optional(),
}).strict();
export const adminInventoryListSchema = z.object({
  ...pagination,
  pharmacyId: uuidSchema.optional(),
  medicineId: uuidSchema.optional(),
  availability: z.enum(InventoryStatus).optional(),
  freshness: z.enum(["FRESH", "STALE"]).optional(),
}).strict();
export type AdminPharmacyListQuery = z.infer<typeof adminPharmacyListSchema>;
export type AdminInventoryListQuery = z.infer<typeof adminInventoryListSchema>;

export const adminOrderListSchema = z.object({
  ...pagination,
  status: z.enum(OrderStatus).optional(),
  fulfillmentMethod: z.enum(FulfillmentMethod).optional(),
  pharmacyId: uuidSchema.optional(),
  requiresPrescription: booleanQuery.optional(),
  prescriptionStatus: z.enum(PrescriptionStatus).optional(),
}).strict();
export type AdminOrderListQuery = z.infer<typeof adminOrderListSchema>;
