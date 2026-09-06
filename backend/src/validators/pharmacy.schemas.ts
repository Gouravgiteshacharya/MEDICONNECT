import { z } from "zod";

import {
  emailSchema,
  optionalNullableTrimmedText,
  trimmedText,
  uuidSchema,
} from "./common.schemas.js";

export const pharmacyParamsSchema = z
  .object({
    pharmacyId: uuidSchema,
  })
  .strict();

export const updatePharmacyProfileSchema = z
  .object({
    name: trimmedText(160).optional(),
    description: optionalNullableTrimmedText(2_000),
    phone: z.string().trim().min(7).max(20).optional(),
    email: emailSchema.nullable().optional(),
    addressLine1: trimmedText(240).optional(),
    addressLine2: optionalNullableTrimmedText(240),
    city: trimmedText(120).optional(),
    state: trimmedText(120).optional(),
    postalCode: trimmedText(20).optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one pharmacy profile field must be provided.",
  });

export type UpdatePharmacyProfileInput = z.infer<
  typeof updatePharmacyProfileSchema
>;
