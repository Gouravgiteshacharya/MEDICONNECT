import { z } from "zod";
import { PrescriptionStatus } from "../../generated/prisma/client.js";

import { uuidSchema } from "./common.schemas.js";

const reviewNotesSchema = z.string().trim().min(1).max(2000);
const rejectionReasonSchema = z.string().trim().min(1).max(1000);

export const prescriptionReviewParamsSchema = z
  .object({
    pharmacyId: uuidSchema,
    prescriptionId: uuidSchema,
  })
  .strict();

export const reviewPrescriptionSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal(PrescriptionStatus.APPROVED),
      reviewNotes: reviewNotesSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal(PrescriptionStatus.REJECTED),
      rejectionReason: rejectionReasonSchema,
      reviewNotes: reviewNotesSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal(PrescriptionStatus.ADDITIONAL_INFO_REQUIRED),
      reviewNotes: reviewNotesSchema,
    })
    .strict(),
]);

export const orderDecisionParamsSchema = z
  .object({
    pharmacyId: uuidSchema,
    orderId: uuidSchema,
  })
  .strict();

export const decideOrderSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("CONFIRM") }).strict(),
  z.object({ decision: z.literal("REJECT") }).strict(),
]);

export type ReviewPrescriptionInput = z.infer<
  typeof reviewPrescriptionSchema
>;
export type DecideOrderInput = z.infer<typeof decideOrderSchema>;
