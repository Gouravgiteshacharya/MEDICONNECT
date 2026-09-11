import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email();

export const uuidSchema = z.string().uuid();

export function trimmedText(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

export function optionalNullableTrimmedText(maxLength: number) {
  return trimmedText(maxLength).nullable().optional();
}
