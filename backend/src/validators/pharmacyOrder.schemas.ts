import { z } from "zod";
import { FulfillmentMethod } from "../../generated/prisma/client.js";
import { orderHistoryQuerySchema } from "./order.schemas.js";

export const pharmacyOrderListQuerySchema = orderHistoryQuerySchema.extend({
  fulfillmentMethod: z.enum(FulfillmentMethod).optional(),
});

export type PharmacyOrderListQuery = z.infer<typeof pharmacyOrderListQuerySchema>;
