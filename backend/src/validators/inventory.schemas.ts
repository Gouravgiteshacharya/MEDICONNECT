import { InventoryStatus } from "../../generated/prisma/client.js";
import { z } from "zod";

import { uuidSchema } from "./common.schemas.js";

export const inventoryParamsSchema = z
  .object({
    pharmacyId: uuidSchema,
    inventoryId: uuidSchema.optional(),
  })
  .strict();

const positiveIntegerQueryValue = z.coerce.number().int().positive();

export const inventoryListQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(120)
      .transform((value) => value || undefined)
      .optional(),
    availability: z.enum(InventoryStatus).optional(),
    page: positiveIntegerQueryValue.default(1),
    pageSize: positiveIntegerQueryValue.max(100).default(20),
  })
  .strict();

const sellingPriceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(?:\.\d{1,2})?$/)
  .refine((value) => Number(value) > 0, {
    message: "Selling price must be positive.",
  });

export const createInventorySchema = z
  .object({
    medicineId: uuidSchema,
    quantity: z.number().int().min(0),
    sellingPrice: sellingPriceSchema,
    availability: z.enum(InventoryStatus),
  })
  .strict();

export const updateInventorySchema = z
  .object({
    quantity: z.number().int().min(0).optional(),
    sellingPrice: sellingPriceSchema.optional(),
    availability: z.enum(InventoryStatus).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one inventory field must be provided.",
  });

export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
export type CreateInventoryInput = z.infer<typeof createInventorySchema>;
export type UpdateInventoryInput = z.infer<typeof updateInventorySchema>;
