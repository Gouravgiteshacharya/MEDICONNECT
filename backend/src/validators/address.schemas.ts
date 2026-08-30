import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();

const addressFields = {
  label: z.string().trim().min(1).max(80),
  addressLine1: z.string().trim().min(1).max(240),
  addressLine2: optionalText(240),
  landmark: optionalText(160),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().min(1).max(20),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  isDefault: z.boolean().optional(),
};

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
