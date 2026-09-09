import { z } from "zod";

import { uuidSchema } from "./common.schemas.js";

export const prescriptionOrderParamsSchema = z
  .object({ orderId: uuidSchema })
  .strict();

export const createPrescriptionSchema = z
  .object({
    fileUrl: z.string().trim().min(1).url().max(2048),
    storagePath: z.string().trim().min(1).max(1024).optional(),
    originalFilename: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export type CreatePrescriptionInput = z.infer<
  typeof createPrescriptionSchema
>;
