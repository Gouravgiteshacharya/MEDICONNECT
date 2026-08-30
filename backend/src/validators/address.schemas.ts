import { z } from "zod";

import {
  optionalNullableTrimmedText,
  trimmedText,
  uuidSchema,
} from "./common.schemas.js";

const addressFields = {
  label: trimmedText(80),
  addressLine1: trimmedText(240),
  addressLine2: optionalNullableTrimmedText(240),
  landmark: optionalNullableTrimmedText(160),
  city: trimmedText(120),
  state: trimmedText(120),
  postalCode: trimmedText(20),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  isDefault: z.boolean().optional(),
};

export const addressParamsSchema = z
  .object({
    addressId: uuidSchema,
  })
  .strict();

export const createAddressSchema = z.object(addressFields).strict();

export const updateAddressSchema = z
  .object({
    label: addressFields.label.optional(),
    addressLine1: addressFields.addressLine1.optional(),
    addressLine2: addressFields.addressLine2,
    landmark: addressFields.landmark,
    city: addressFields.city.optional(),
    state: addressFields.state.optional(),
    postalCode: addressFields.postalCode.optional(),
    latitude: addressFields.latitude,
    longitude: addressFields.longitude,
    isDefault: addressFields.isDefault,
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one address field must be provided.",
  });

export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
