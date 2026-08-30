import { z } from "zod";

import { emailSchema, trimmedText } from "./common.schemas.js";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters long.")
  .max(128, "Password must be at most 128 characters long.");

export const registerSchema = z
  .object({
    name: trimmedText(120),
    email: emailSchema,
    phone: z.string().trim().min(7).max(20).optional(),
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
