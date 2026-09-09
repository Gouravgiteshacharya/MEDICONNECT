import { z } from "zod";
import {
  FulfillmentMethod,
  OrderStatus,
} from "../../generated/prisma/client.js";

import { uuidSchema } from "./common.schemas.js";

export const createOrderSchema = z.discriminatedUnion("fulfillmentMethod", [
  z
    .object({
      fulfillmentMethod: z.literal(FulfillmentMethod.DELIVERY),
      deliveryQuoteId: uuidSchema,
    })
    .strict(),
  z
    .object({
      fulfillmentMethod: z.literal(FulfillmentMethod.SELF_PICKUP),
    })
    .strict(),
]);

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const orderHistoryQuerySchema = z
  .object({
    status: z.enum(OrderStatus).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: uuidSchema.optional(),
  })
  .strict();

export const orderParamsSchema = z.object({ orderId: uuidSchema }).strict();

export type OrderHistoryQuery = z.infer<typeof orderHistoryQuerySchema>;
