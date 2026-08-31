import { z } from "zod";

const positiveIntegerQuery = z.coerce.number().finite().int().positive();

export const medicineAlternativesQuerySchema = z
  .object({
    page: positiveIntegerQuery.default(1),
    pageSize: positiveIntegerQuery.max(100).default(20),
  })
  .strict();

export type MedicineAlternativesQuery = z.infer<
  typeof medicineAlternativesQuerySchema
>;
