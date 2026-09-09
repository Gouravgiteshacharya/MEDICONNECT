import { z } from "zod";
import { FulfillmentMethod } from "../../generated/prisma/client.js";

import { uuidSchema } from "./common.schemas.js";

export const cartItemParamsSchema = z
  .object({
    itemId: uuidSchema,
  })
  .strict();

export const updateCartItemQuantitySchema = z
  .object({
    quantity: z.number().int().min(1),
  })
  .strict();

export const addCartItemSchema = z
  .object({
    pharmacyId: uuidSchema,
    medicineId: uuidSchema,
    quantity: z.number().int().min(1),
  })
  .strict();

export const updateCartFulfillmentSchema = z.discriminatedUnion(
  "fulfillmentMethod",
  [
    z
      .object({
        fulfillmentMethod: z.literal(FulfillmentMethod.DELIVERY),
        deliveryAddressId: uuidSchema,
      })
      .strict(),
    z
      .object({
        fulfillmentMethod: z.literal(FulfillmentMethod.SELF_PICKUP),
      })
      .strict(),
  ],
);

export type UpdateCartItemQuantityInput = z.infer<
  typeof updateCartItemQuantitySchema
>;
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartFulfillmentInput = z.infer<
  typeof updateCartFulfillmentSchema
>;
