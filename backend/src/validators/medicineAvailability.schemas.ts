import { z } from "zod";

const finiteNumberQuery = z.coerce.number().finite();
const positiveIntegerQuery = z.coerce.number().finite().int().positive();

export const medicineAvailabilityQuerySchema = z
  .object({
    latitude: finiteNumberQuery.min(-90).max(90),
    longitude: finiteNumberQuery.min(-180).max(180),
    radiusKm: finiteNumberQuery.positive().max(50).default(5),
    page: positiveIntegerQuery.default(1),
    pageSize: positiveIntegerQuery.max(100).default(20),
  })
  .strict();

export type MedicineAvailabilityQuery = z.infer<
  typeof medicineAvailabilityQuerySchema
>;
