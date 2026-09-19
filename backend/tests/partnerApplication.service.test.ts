import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PartnerVerificationResult,
  PharmacyApplicationStatus,
  RiderApplicationStatus,
  UserRole,
} from "../generated/prisma/client.js";

const prisma = vi.hoisted(() => ({
  pharmacyPartnerApplication: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  riderPartnerApplication: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  pharmacyFieldVisitVerification: { upsert: vi.fn() },
  riderOfficeVerification: { upsert: vi.fn() },
  user: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
const storage = vi.hoisted(() => ({ upload: vi.fn(), delete: vi.fn(), createSignedUrl: vi.fn() }));

vi.mock("../src/lib/prisma.js", () => ({ prisma }));
vi.mock("../src/services/prescriptionStorage.service.js", () => ({ prescriptionStorage: storage }));
vi.mock("../src/utils/password.js", () => ({ hashPassword: vi.fn().mockResolvedValue("hashed-temporary-credential") }));

const {
  approvePharmacyApplication,
  approveRiderApplication,
  recordFieldVisit,
  recordOfficeVerification,
  submitPharmacyApplication,
  submitRiderApplication,
  transitionPharmacyApplication,
} = await import("../src/services/partnerApplication.service.js");

const applicationId = "33333333-3333-4333-8333-333333333333";
const adminId = "22222222-2222-4222-8222-222222222222";

const pharmacyApplication = {
  id: applicationId, pharmacyName: "Local Care", contactName: "Owner", contactEmail: "owner@example.com", phone: "9999999999",
  addressLine1: "Main Road", addressLine2: null, city: "Keonjhar", state: "Odisha", postalCode: "758001", latitude: 21.63, longitude: 85.58,
  licenseNumber: "LIC-1", status: PharmacyApplicationStatus.FIELD_VISIT_COMPLETED,
  fieldVisit: { result: PartnerVerificationResult.PASSED },
};

const riderApplication = {
  id: applicationId, fullName: "Rider", email: "rider@example.com", phone: "8888888888", vehicleType: "BIKE", vehicleNumber: "OD09AA1234",
  status: RiderApplicationStatus.OFFICE_VERIFICATION_COMPLETED,
  officeVerification: { result: PartnerVerificationResult.PASSED },
};

describe("partner application service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.upload.mockResolvedValue(undefined);
    storage.delete.mockResolvedValue(undefined);
    prisma.user.findFirst.mockResolvedValue(null);
  });

  it("rejects obvious duplicate pharmacy and rider applications", async () => {
    prisma.pharmacyPartnerApplication.findFirst.mockResolvedValue({ id: applicationId });
    const photo = { originalname: "pharmacy.png", mimetype: "image/png", buffer: Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]) } as Express.Multer.File;
    const pharmacyInput = { pharmacyName: "Local Care", contactName: "Owner", contactEmail: "owner@example.com", phone: "9999999999", addressLine1: "Road", city: "Keonjhar", state: "Odisha", postalCode: "758001", latitude: 21.63, longitude: 85.58, licenseNumber: "LIC-1", operatingInfo: "Open daily", pickupAvailable: true, consentAccepted: true } as never;
    await expect(submitPharmacyApplication(pharmacyInput, photo)).rejects.toMatchObject({ code: "PHARMACY_APPLICATION_DUPLICATE" });
    expect(storage.upload).not.toHaveBeenCalled();
    const riderInput = { fullName: "Rider", email: "rider@example.com", phone: "8888888888", addressLine1: "Road", city: "Keonjhar", state: "Odisha", postalCode: "758001", vehicleType: "BIKE", drivingLicenseNumber: "DL-1", consentAccepted: true } as never;
    prisma.riderPartnerApplication.findFirst.mockResolvedValue({ id: applicationId });
    await expect(submitRiderApplication(riderInput)).rejects.toMatchObject({ code: "RIDER_APPLICATION_DUPLICATE" });
  });

  it("prevents pharmacy and rider activation before required verification", async () => {
    prisma.pharmacyPartnerApplication.findUnique.mockResolvedValue({ ...pharmacyApplication, status: PharmacyApplicationStatus.FIELD_VISIT_PENDING });
    await expect(approvePharmacyApplication(applicationId)).rejects.toMatchObject({ code: "PARTNER_APPLICATION_TRANSITION_INVALID" });
    prisma.riderPartnerApplication.findUnique.mockResolvedValue({ ...riderApplication, status: RiderApplicationStatus.OFFICE_VERIFICATION_PENDING });
    await expect(approveRiderApplication(applicationId)).rejects.toMatchObject({ code: "PARTNER_APPLICATION_TRANSITION_INVALID" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid transitions and rejection never creates an account", async () => {
    prisma.pharmacyPartnerApplication.findUnique.mockResolvedValue({ status: PharmacyApplicationStatus.APPLICATION_SUBMITTED });
    await expect(transitionPharmacyApplication(applicationId, { status: PharmacyApplicationStatus.FIELD_VISIT_PENDING } as never)).rejects.toMatchObject({ code: "PARTNER_APPLICATION_TRANSITION_INVALID" });
    prisma.pharmacyPartnerApplication.update.mockResolvedValue({ id: applicationId, status: PharmacyApplicationStatus.REJECTED });
    await transitionPharmacyApplication(applicationId, { status: PharmacyApplicationStatus.REJECTED, reason: "Licence invalid" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("records passed field and office verification before completion", async () => {
    prisma.pharmacyPartnerApplication.findUnique.mockResolvedValue({ status: PharmacyApplicationStatus.FIELD_VISIT_PENDING });
    prisma.pharmacyFieldVisitVerification.upsert.mockResolvedValue({ result: PartnerVerificationResult.PASSED });
    prisma.pharmacyPartnerApplication.update.mockResolvedValue({});
    await recordFieldVisit(applicationId, adminId, { visitedAt: new Date(), checklist: {}, result: PartnerVerificationResult.PASSED });
    expect(prisma.pharmacyPartnerApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: PharmacyApplicationStatus.FIELD_VISIT_COMPLETED } }));
    prisma.riderPartnerApplication.findUnique.mockResolvedValue({ status: RiderApplicationStatus.OFFICE_VERIFICATION_PENDING });
    prisma.riderOfficeVerification.upsert.mockResolvedValue({ result: PartnerVerificationResult.PASSED });
    prisma.riderPartnerApplication.update.mockResolvedValue({});
    await recordOfficeVerification(applicationId, adminId, { verifiedAt: new Date(), checklist: {}, result: PartnerVerificationResult.PASSED });
    expect(prisma.riderPartnerApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: RiderApplicationStatus.OFFICE_VERIFICATION_COMPLETED } }));
  });

  it("approves a verified pharmacy with PHARMACY_STAFF, active pharmacy, and OWNER membership", async () => {
    prisma.pharmacyPartnerApplication.findUnique.mockResolvedValue(pharmacyApplication);
    const tx = { user: { create: vi.fn().mockResolvedValue({ id: "user", role: UserRole.PHARMACY_STAFF }) }, pharmacy: { create: vi.fn().mockResolvedValue({ id: "pharmacy", partnerStatus: "ACTIVE" }) }, pharmacyStaff: { create: vi.fn().mockResolvedValue({}) }, pharmacyPartnerApplication: { update: vi.fn().mockResolvedValue({}) } };
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    const result = await approvePharmacyApplication(applicationId);
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: UserRole.PHARMACY_STAFF, passwordHash: "hashed-temporary-credential" }) }));
    expect(tx.pharmacy.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true, isVerified: true, partnerStatus: "ACTIVE" }) }));
    expect(tx.pharmacyStaff.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "OWNER" }) }));
    expect(result.temporaryCredential).toEqual(expect.any(String));
  });

  it("approves a verified rider with DELIVERY_PARTNER and an active OFFLINE profile", async () => {
    prisma.riderPartnerApplication.findUnique.mockResolvedValue(riderApplication);
    const tx = { user: { create: vi.fn().mockResolvedValue({ id: "user", role: UserRole.DELIVERY_PARTNER }) }, deliveryPartner: { create: vi.fn().mockResolvedValue({ id: "rider", availability: "OFFLINE", isActive: true }) }, riderPartnerApplication: { update: vi.fn().mockResolvedValue({}) } };
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    await approveRiderApplication(applicationId);
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: UserRole.DELIVERY_PARTNER, passwordHash: "hashed-temporary-credential" }) }));
    expect(tx.deliveryPartner.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ availability: "OFFLINE", isActive: true }) }));
  });
});
