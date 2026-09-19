import { randomBytes, randomUUID } from "node:crypto";

import {
  DeliveryPartnerAvailability,
  PartnerVerificationResult,
  PharmacyApplicationStatus,
  PharmacyPartnerStatus,
  PharmacyStaffRole,
  RiderApplicationStatus,
  UserRole,
  Prisma,
} from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { hashPassword } from "../utils/password.js";
import { prescriptionStorage } from "./prescriptionStorage.service.js";
import type {
  FieldVisitInput,
  OfficeVerificationInput,
  PharmacyApplicationInput,
  PharmacyApplicationListInput,
  PharmacyTransitionInput,
  RiderApplicationInput,
  RiderApplicationListInput,
  RiderTransitionInput,
} from "../validators/partnerApplication.schemas.js";

const pharmacySummarySelect = {
  id: true,
  pharmacyName: true,
  contactName: true,
  contactEmail: true,
  phone: true,
  city: true,
  state: true,
  licenseNumber: true,
  status: true,
  submittedAt: true,
  updatedAt: true,
} satisfies Prisma.PharmacyPartnerApplicationSelect;

const pharmacyDetailSelect = {
  ...pharmacySummarySelect,
  addressLine1: true,
  addressLine2: true,
  postalCode: true,
  latitude: true,
  longitude: true,
  locationCapturedAt: true,
  gstNumber: true,
  pharmacistDetails: true,
  operatingInfo: true,
  pickupAvailable: true,
  deliverySupportInfo: true,
  photoOriginalFilename: true,
  photoMimeType: true,
  photoUploadedAt: true,
  consentAcceptedAt: true,
  rejectionReason: true,
  approvedUserId: true,
  approvedPharmacyId: true,
  fieldVisit: true,
} satisfies Prisma.PharmacyPartnerApplicationSelect;

const riderSummarySelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  city: true,
  state: true,
  vehicleType: true,
  status: true,
  submittedAt: true,
  updatedAt: true,
} satisfies Prisma.RiderPartnerApplicationSelect;

const riderDetailSelect = {
  ...riderSummarySelect,
  addressLine1: true,
  addressLine2: true,
  postalCode: true,
  dateOfBirth: true,
  vehicleNumber: true,
  drivingLicenseNumber: true,
  identityDocumentReference: true,
  emergencyContact: true,
  consentAcceptedAt: true,
  rejectionReason: true,
  approvedUserId: true,
  officeVerification: true,
} satisfies Prisma.RiderPartnerApplicationSelect;

function conflict(message: string, code = "PARTNER_APPLICATION_CONFLICT") {
  return new ApiError(409, message, code);
}

function notFound(kind: "pharmacy" | "rider") {
  return new ApiError(404, `${kind === "pharmacy" ? "Pharmacy" : "Rider"} application not found.`, "PARTNER_APPLICATION_NOT_FOUND");
}

function invalidTransition() {
  return new ApiError(409, "This application transition is not allowed.", "PARTNER_APPLICATION_TRANSITION_INVALID");
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function validatePhoto(file: Express.Multer.File | undefined) {
  if (!file) throw new ApiError(400, "A pharmacy photo is required.", "PARTNER_PHOTO_REQUIRED");
  const jpeg = file.mimetype === "image/jpeg" && file.buffer.length >= 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
  const png = file.mimetype === "image/png" && file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!jpeg && !png) {
    throw new ApiError(415, "The pharmacy photo must be a valid JPEG or PNG.", "PARTNER_PHOTO_TYPE_UNSUPPORTED");
  }
  return file;
}

function safeFilename(value: string) {
  return (value.split(/[\\/]/).pop() ?? "pharmacy-photo")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 180) || "pharmacy-photo";
}

export async function submitPharmacyApplication(input: PharmacyApplicationInput, uploadedFile: Express.Multer.File | undefined) {
  const file = validatePhoto(uploadedFile);
  const duplicate = await prisma.pharmacyPartnerApplication.findFirst({
    where: {
      status: { not: PharmacyApplicationStatus.REJECTED },
      OR: [
        { contactEmail: { equals: input.contactEmail, mode: "insensitive" } },
        { phone: input.phone },
        { licenseNumber: { equals: input.licenseNumber, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (duplicate) throw conflict("An active pharmacy application already uses this email, phone, or licence number.", "PHARMACY_APPLICATION_DUPLICATE");

  const applicationId = randomUUID();
  const filename = safeFilename(file.originalname);
  const storagePath = `partner-applications/pharmacies/${applicationId}/${randomUUID()}-${filename}`;
  await prescriptionStorage.upload({ key: storagePath, content: file.buffer, contentType: file.mimetype });
  try {
    const application = await prisma.pharmacyPartnerApplication.create({
      data: {
        id: applicationId,
        pharmacyName: input.pharmacyName,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        phone: input.phone,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        latitude: input.latitude,
        longitude: input.longitude,
        locationCapturedAt: input.locationCapturedAt,
        licenseNumber: input.licenseNumber,
        gstNumber: input.gstNumber,
        pharmacistDetails: input.pharmacistDetails,
        operatingInfo: input.operatingInfo,
        pickupAvailable: input.pickupAvailable,
        deliverySupportInfo: input.deliverySupportInfo,
        photoStoragePath: storagePath,
        photoOriginalFilename: filename,
        photoMimeType: file.mimetype,
        consentAcceptedAt: new Date(),
      },
      select: pharmacySummarySelect,
    });
    return application;
  } catch (error) {
    await prescriptionStorage.delete(storagePath);
    if (isUniqueConflict(error)) {
      throw conflict("An active pharmacy application already uses this email, phone, or licence number.", "PHARMACY_APPLICATION_DUPLICATE");
    }
    throw error;
  }
}

export async function submitRiderApplication(input: RiderApplicationInput) {
  const duplicate = await prisma.riderPartnerApplication.findFirst({
    where: {
      status: { not: RiderApplicationStatus.REJECTED },
      OR: [
        { email: { equals: input.email, mode: "insensitive" } },
        { phone: input.phone },
        ...(input.drivingLicenseNumber ? [{ drivingLicenseNumber: { equals: input.drivingLicenseNumber, mode: "insensitive" as const } }] : []),
      ],
    },
    select: { id: true },
  });
  if (duplicate) throw conflict("An active rider application already uses this email, phone, or driving licence.", "RIDER_APPLICATION_DUPLICATE");
  try {
    return await prisma.riderPartnerApplication.create({
      data: {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      dateOfBirth: input.dateOfBirth,
      vehicleType: input.vehicleType,
      vehicleNumber: input.vehicleNumber,
      drivingLicenseNumber: input.drivingLicenseNumber,
      identityDocumentReference: input.identityDocumentReference,
      emergencyContact: input.emergencyContact,
      consentAcceptedAt: new Date(),
      },
      select: riderSummarySelect,
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw conflict("An active rider application already uses this email, phone, or driving licence.", "RIDER_APPLICATION_DUPLICATE");
    }
    throw error;
  }
}

function pageOf<T extends { id: string }>(records: T[], limit: number) {
  const hasMore = records.length > limit;
  const page = hasMore ? records.slice(0, limit) : records;
  return { page, nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
}

export async function listPharmacyApplications(query: PharmacyApplicationListInput) {
  const records = await prisma.pharmacyPartnerApplication.findMany({
    where: query.status ? { status: query.status } : {},
    select: pharmacySummarySelect,
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const { page, nextCursor } = pageOf(records, query.limit);
  return { applications: page, nextCursor };
}

export async function listRiderApplications(query: RiderApplicationListInput) {
  const records = await prisma.riderPartnerApplication.findMany({
    where: query.status ? { status: query.status } : {},
    select: riderSummarySelect,
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const { page, nextCursor } = pageOf(records, query.limit);
  return { applications: page, nextCursor };
}

export async function getPharmacyApplication(applicationId: string) {
  const application = await prisma.pharmacyPartnerApplication.findUnique({ where: { id: applicationId }, select: pharmacyDetailSelect });
  if (!application) throw notFound("pharmacy");
  return application;
}

export async function getRiderApplication(applicationId: string) {
  const application = await prisma.riderPartnerApplication.findUnique({ where: { id: applicationId }, select: riderDetailSelect });
  if (!application) throw notFound("rider");
  return application;
}

export async function createPharmacyPhotoAccess(applicationId: string) {
  const application = await prisma.pharmacyPartnerApplication.findUnique({ where: { id: applicationId }, select: { photoStoragePath: true } });
  if (!application) throw notFound("pharmacy");
  return prescriptionStorage.createSignedUrl(application.photoStoragePath, 300);
}

const pharmacyTransitions: Record<PharmacyApplicationStatus, PharmacyApplicationStatus[]> = {
  APPLICATION_SUBMITTED: [PharmacyApplicationStatus.DOCUMENT_REVIEW, PharmacyApplicationStatus.REJECTED],
  DOCUMENT_REVIEW: [PharmacyApplicationStatus.FIELD_VISIT_PENDING, PharmacyApplicationStatus.REJECTED],
  FIELD_VISIT_PENDING: [PharmacyApplicationStatus.REJECTED],
  FIELD_VISIT_COMPLETED: [PharmacyApplicationStatus.REJECTED],
  APPROVED: [],
  REJECTED: [],
};

const riderTransitions: Record<RiderApplicationStatus, RiderApplicationStatus[]> = {
  APPLICATION_SUBMITTED: [RiderApplicationStatus.DOCUMENT_REVIEW, RiderApplicationStatus.REJECTED],
  DOCUMENT_REVIEW: [RiderApplicationStatus.OFFICE_VERIFICATION_PENDING, RiderApplicationStatus.REJECTED],
  OFFICE_VERIFICATION_PENDING: [RiderApplicationStatus.REJECTED],
  OFFICE_VERIFICATION_COMPLETED: [RiderApplicationStatus.REJECTED],
  APPROVED: [],
  REJECTED: [],
};

export async function transitionPharmacyApplication(applicationId: string, input: PharmacyTransitionInput) {
  const current = await prisma.pharmacyPartnerApplication.findUnique({ where: { id: applicationId }, select: { status: true } });
  if (!current) throw notFound("pharmacy");
  if (!pharmacyTransitions[current.status].includes(input.status)) throw invalidTransition();
  if (input.status === PharmacyApplicationStatus.REJECTED && !input.reason) throw conflict("A rejection reason is required.", "REJECTION_REASON_REQUIRED");
  return prisma.pharmacyPartnerApplication.update({
    where: { id: applicationId },
    data: { status: input.status, rejectionReason: input.status === PharmacyApplicationStatus.REJECTED ? input.reason : null },
    select: pharmacyDetailSelect,
  });
}

export async function transitionRiderApplication(applicationId: string, input: RiderTransitionInput) {
  const current = await prisma.riderPartnerApplication.findUnique({ where: { id: applicationId }, select: { status: true } });
  if (!current) throw notFound("rider");
  if (!riderTransitions[current.status].includes(input.status)) throw invalidTransition();
  if (input.status === RiderApplicationStatus.REJECTED && !input.reason) throw conflict("A rejection reason is required.", "REJECTION_REASON_REQUIRED");
  return prisma.riderPartnerApplication.update({
    where: { id: applicationId },
    data: { status: input.status, rejectionReason: input.status === RiderApplicationStatus.REJECTED ? input.reason : null },
    select: riderDetailSelect,
  });
}

export async function recordFieldVisit(applicationId: string, adminId: string, input: FieldVisitInput) {
  const application = await prisma.pharmacyPartnerApplication.findUnique({ where: { id: applicationId }, select: { status: true } });
  if (!application) throw notFound("pharmacy");
  if (application.status !== PharmacyApplicationStatus.FIELD_VISIT_PENDING) throw invalidTransition();
  const verification = await prisma.pharmacyFieldVisitVerification.upsert({
    where: { applicationId },
    create: { applicationId, verifierAdminId: adminId, ...input },
    update: { verifierAdminId: adminId, ...input },
  });
  if (input.result === PartnerVerificationResult.PASSED && input.visitedAt) {
    await prisma.pharmacyPartnerApplication.update({ where: { id: applicationId }, data: { status: PharmacyApplicationStatus.FIELD_VISIT_COMPLETED } });
  }
  return verification;
}

export async function recordOfficeVerification(applicationId: string, adminId: string, input: OfficeVerificationInput) {
  const application = await prisma.riderPartnerApplication.findUnique({ where: { id: applicationId }, select: { status: true } });
  if (!application) throw notFound("rider");
  if (application.status !== RiderApplicationStatus.OFFICE_VERIFICATION_PENDING) throw invalidTransition();
  const verification = await prisma.riderOfficeVerification.upsert({
    where: { applicationId },
    create: { applicationId, verifierAdminId: adminId, ...input },
    update: { verifierAdminId: adminId, ...input },
  });
  if (input.result === PartnerVerificationResult.PASSED && input.verifiedAt) {
    await prisma.riderPartnerApplication.update({ where: { id: applicationId }, data: { status: RiderApplicationStatus.OFFICE_VERIFICATION_COMPLETED } });
  }
  return verification;
}

function temporaryCredential() {
  return randomBytes(18).toString("base64url");
}

export async function approvePharmacyApplication(applicationId: string) {
  const application = await prisma.pharmacyPartnerApplication.findUnique({ where: { id: applicationId }, include: { fieldVisit: true } });
  if (!application) throw notFound("pharmacy");
  if (application.status !== PharmacyApplicationStatus.FIELD_VISIT_COMPLETED || application.fieldVisit?.result !== PartnerVerificationResult.PASSED) throw invalidTransition();
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: { equals: application.contactEmail, mode: "insensitive" } }, { phone: application.phone }] }, select: { id: true } });
  if (existing) throw conflict("A user already exists with this email or phone.", "PARTNER_ACCOUNT_CONFLICT");
  const credential = temporaryCredential();
  const passwordHash = await hashPassword(credential);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name: application.contactName, email: application.contactEmail, phone: application.phone, passwordHash, role: UserRole.PHARMACY_STAFF }, select: { id: true, email: true, role: true } });
    const pharmacy = await tx.pharmacy.create({ data: { name: application.pharmacyName, phone: application.phone, email: application.contactEmail, licenseNumber: application.licenseNumber, addressLine1: application.addressLine1, addressLine2: application.addressLine2, city: application.city, state: application.state, postalCode: application.postalCode, latitude: application.latitude, longitude: application.longitude, isVerified: true, isActive: true, partnerStatus: PharmacyPartnerStatus.ACTIVE }, select: { id: true, name: true, partnerStatus: true } });
    await tx.pharmacyStaff.create({ data: { userId: user.id, pharmacyId: pharmacy.id, role: PharmacyStaffRole.OWNER, isActive: true } });
    await tx.pharmacyPartnerApplication.update({ where: { id: applicationId }, data: { status: PharmacyApplicationStatus.APPROVED, approvedUserId: user.id, approvedPharmacyId: pharmacy.id } });
    return { user, pharmacy };
  });
  return { ...result, temporaryCredential: credential };
}

export async function approveRiderApplication(applicationId: string) {
  const application = await prisma.riderPartnerApplication.findUnique({ where: { id: applicationId }, include: { officeVerification: true } });
  if (!application) throw notFound("rider");
  if (application.status !== RiderApplicationStatus.OFFICE_VERIFICATION_COMPLETED || application.officeVerification?.result !== PartnerVerificationResult.PASSED) throw invalidTransition();
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: { equals: application.email, mode: "insensitive" } }, { phone: application.phone }] }, select: { id: true } });
  if (existing) throw conflict("A user already exists with this email or phone.", "PARTNER_ACCOUNT_CONFLICT");
  const credential = temporaryCredential();
  const passwordHash = await hashPassword(credential);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name: application.fullName, email: application.email, phone: application.phone, passwordHash, role: UserRole.DELIVERY_PARTNER }, select: { id: true, email: true, role: true } });
    const rider = await tx.deliveryPartner.create({ data: { userId: user.id, vehicleType: application.vehicleType, vehicleNumber: application.vehicleNumber, availability: DeliveryPartnerAvailability.OFFLINE, isActive: true }, select: { id: true, availability: true, isActive: true } });
    await tx.riderPartnerApplication.update({ where: { id: applicationId }, data: { status: RiderApplicationStatus.APPROVED, approvedUserId: user.id } });
    return { user, rider };
  });
  return { ...result, temporaryCredential: credential };
}
