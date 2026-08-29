import { z } from "zod";

export const updateUserProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().min(7).max(20).nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one profile field must be provided.",
  });

export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
