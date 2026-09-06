import { z } from "zod";

import { uuidSchema } from "./common.schemas.js";

export const medicineParamsSchema = z
  .object({
    medicineId: uuidSchema,
  })
  .strict();

const positiveIntegerQueryValue = z.coerce.number().int().positive();

export const medicineListQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(120)
      .transform((value) => value || undefined)
      .optional(),
    page: positiveIntegerQueryValue.default(1),
    pageSize: positiveIntegerQueryValue.max(100).default(20),
  })
  .strict();

export type MedicineListQuery = z.infer<typeof medicineListQuerySchema>;
