import { z } from "zod";
import { PrescriptionStatus } from "../../generated/prisma/client.js";
import { uuidSchema } from "./common.schemas.js";

export const pharmacyPrescriptionListQuerySchema = z.object({
  status: z.enum(PrescriptionStatus).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: uuidSchema.optional(),
}).strict();

export type PharmacyPrescriptionListQuery = z.infer<typeof pharmacyPrescriptionListQuerySchema>;
