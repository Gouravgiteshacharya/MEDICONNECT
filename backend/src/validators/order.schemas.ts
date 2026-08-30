import { z } from "zod";
import { FulfillmentMethod } from "../../generated/prisma/client.js";

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
