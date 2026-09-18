import { z } from "zod";

import { uuidSchema } from "./common.schemas.js";

export const prescriptionOrderParamsSchema = z
  .object({
    orderId: uuidSchema,
  })
  .strict();

export const createPrescriptionSchema = z
  .object({
    supersedesPrescriptionId: uuidSchema.optional(),
  })
  .strict();

export const prescriptionParamsSchema = z
  .object({ prescriptionId: uuidSchema })
  .strict();

export const prescriptionLibraryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: uuidSchema.optional(),
  })
  .strict();

export type CreatePrescriptionInput = z.infer<
  typeof createPrescriptionSchema
>;

export type PrescriptionLibraryQuery = z.infer<
  typeof prescriptionLibraryQuerySchema
>;
