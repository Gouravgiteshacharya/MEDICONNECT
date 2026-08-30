import { z } from "zod";

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

export type UpdateCartItemQuantityInput = z.infer<
  typeof updateCartItemQuantitySchema
>;
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
