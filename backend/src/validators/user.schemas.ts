import { z } from "zod";

import { emailSchema, trimmedText } from "./common.schemas.js";

export const updateUserProfileSchema = z
  .object({
    name: trimmedText(120).optional(),
    email: emailSchema.optional(),
    phone: z.string().trim().min(7).max(20).nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one profile field must be provided.",
  });

export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
