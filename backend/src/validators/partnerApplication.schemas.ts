import { z } from "zod";

import {
  PartnerVerificationResult,
  PharmacyApplicationStatus,
  RiderApplicationStatus,
  VehicleType,
} from "../../generated/prisma/client.js";
import { emailSchema, trimmedText, uuidSchema } from "./common.schemas.js";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional(),
  );

const multipartBoolean = z.preprocess(
  (value) => value === true || value === "true",
  z.boolean(),
);

const optionalDate = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.coerce.date().optional(),
);

export const pharmacyApplicationSchema = z.object({
  pharmacyName: trimmedText(160),
  contactName: trimmedText(120),
  contactEmail: emailSchema,
  phone: trimmedText(20),
  addressLine1: trimmedText(200),
  addressLine2: optionalText(200),
  city: trimmedText(100),
  state: trimmedText(100),
  postalCode: trimmedText(12),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  locationCapturedAt: optionalDate,
  licenseNumber: trimmedText(80),
  gstNumber: optionalText(30),
  pharmacistDetails: optionalText(500),
  operatingInfo: trimmedText(1000),
  pickupAvailable: multipartBoolean,
  deliverySupportInfo: optionalText(500),
  consentAccepted: z.preprocess(
    (value) => value === true || value === "true",
    z.literal(true),
  ),
}).strict();

export const riderApplicationSchema = z.object({
  fullName: trimmedText(120),
  email: emailSchema,
  phone: trimmedText(20),
  addressLine1: trimmedText(200),
  addressLine2: optionalText(200),
  city: trimmedText(100),
  state: trimmedText(100),
  postalCode: trimmedText(12),
  dateOfBirth: optionalDate,
  vehicleType: z.enum(VehicleType),
  vehicleNumber: optionalText(40),
  drivingLicenseNumber: optionalText(80),
  identityDocumentReference: optionalText(160),
  emergencyContact: optionalText(120),
  consentAccepted: z.literal(true),
}).strict().superRefine((value, context) => {
  if (
    value.vehicleType !== VehicleType.BICYCLE &&
    value.vehicleType !== VehicleType.WALKER &&
    !value.drivingLicenseNumber
  ) {
    context.addIssue({
      code: "custom",
      path: ["drivingLicenseNumber"],
      message: "Driving licence number is required for this vehicle type.",
    });
  }
});

export const applicationParamsSchema = z.object({ applicationId: uuidSchema }).strict();

export const pharmacyApplicationListSchema = z.object({
  status: z.enum(PharmacyApplicationStatus).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: uuidSchema.optional(),
}).strict();

export const riderApplicationListSchema = z.object({
  status: z.enum(RiderApplicationStatus).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: uuidSchema.optional(),
}).strict();

export const pharmacyTransitionSchema = z.object({
  status: z.enum([
    PharmacyApplicationStatus.DOCUMENT_REVIEW,
    PharmacyApplicationStatus.FIELD_VISIT_PENDING,
    PharmacyApplicationStatus.REJECTED,
  ]),
  reason: optionalText(1000),
}).strict();

export const riderTransitionSchema = z.object({
  status: z.enum([
    RiderApplicationStatus.DOCUMENT_REVIEW,
    RiderApplicationStatus.OFFICE_VERIFICATION_PENDING,
    RiderApplicationStatus.REJECTED,
  ]),
  reason: optionalText(1000),
}).strict();

const checklistSchema = z.record(z.string(), z.union([z.boolean(), z.string(), z.number(), z.null()]));

export const fieldVisitSchema = z.object({
  scheduledAt: optionalDate,
  visitedAt: optionalDate,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  notes: optionalText(2000),
  checklist: checklistSchema.default({}),
  result: z.enum(PartnerVerificationResult),
}).strict();

export const officeVerificationSchema = z.object({
  officeName: optionalText(160),
  scheduledAt: optionalDate,
  verifiedAt: optionalDate,
  notes: optionalText(2000),
  checklist: checklistSchema.default({}),
  result: z.enum(PartnerVerificationResult),
}).strict();

export type PharmacyApplicationInput = z.infer<typeof pharmacyApplicationSchema>;
export type RiderApplicationInput = z.infer<typeof riderApplicationSchema>;
export type PharmacyApplicationListInput = z.infer<typeof pharmacyApplicationListSchema>;
export type RiderApplicationListInput = z.infer<typeof riderApplicationListSchema>;
export type PharmacyTransitionInput = z.infer<typeof pharmacyTransitionSchema>;
export type RiderTransitionInput = z.infer<typeof riderTransitionSchema>;
export type FieldVisitInput = z.infer<typeof fieldVisitSchema>;
export type OfficeVerificationInput = z.infer<typeof officeVerificationSchema>;
