-- CreateEnum
CREATE TYPE "PharmacyApplicationStatus" AS ENUM ('APPLICATION_SUBMITTED', 'DOCUMENT_REVIEW', 'FIELD_VISIT_PENDING', 'FIELD_VISIT_COMPLETED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RiderApplicationStatus" AS ENUM ('APPLICATION_SUBMITTED', 'DOCUMENT_REVIEW', 'OFFICE_VERIFICATION_PENDING', 'OFFICE_VERIFICATION_COMPLETED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PartnerVerificationResult" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'NEEDS_FOLLOW_UP');

-- CreateTable
CREATE TABLE "PharmacyPartnerApplication" (
    "id" UUID NOT NULL,
    "pharmacyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "locationCapturedAt" TIMESTAMP(3),
    "licenseNumber" TEXT NOT NULL,
    "gstNumber" TEXT,
    "pharmacistDetails" TEXT,
    "operatingInfo" TEXT NOT NULL,
    "pickupAvailable" BOOLEAN NOT NULL,
    "deliverySupportInfo" TEXT,
    "photoStoragePath" TEXT NOT NULL,
    "photoOriginalFilename" TEXT NOT NULL,
    "photoMimeType" TEXT NOT NULL,
    "photoUploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentAcceptedAt" TIMESTAMP(3) NOT NULL,
    "status" "PharmacyApplicationStatus" NOT NULL DEFAULT 'APPLICATION_SUBMITTED',
    "rejectionReason" TEXT,
    "approvedUserId" UUID,
    "approvedPharmacyId" UUID,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PharmacyPartnerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyFieldVisitVerification" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "verifierAdminId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "visitedAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "notes" TEXT,
    "checklist" JSONB NOT NULL,
    "result" "PartnerVerificationResult" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PharmacyFieldVisitVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderPartnerApplication" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "vehicleType" "VehicleType" NOT NULL,
    "vehicleNumber" TEXT,
    "drivingLicenseNumber" TEXT,
    "identityDocumentReference" TEXT,
    "emergencyContact" TEXT,
    "consentAcceptedAt" TIMESTAMP(3) NOT NULL,
    "status" "RiderApplicationStatus" NOT NULL DEFAULT 'APPLICATION_SUBMITTED',
    "rejectionReason" TEXT,
    "approvedUserId" UUID,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiderPartnerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderOfficeVerification" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "officeName" TEXT,
    "verifierAdminId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "checklist" JSONB NOT NULL,
    "result" "PartnerVerificationResult" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiderOfficeVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PharmacyPartnerApplication_approvedUserId_key" ON "PharmacyPartnerApplication"("approvedUserId");
CREATE UNIQUE INDEX "PharmacyPartnerApplication_approvedPharmacyId_key" ON "PharmacyPartnerApplication"("approvedPharmacyId");
CREATE INDEX "PharmacyPartnerApplication_status_submittedAt_idx" ON "PharmacyPartnerApplication"("status", "submittedAt");
CREATE INDEX "PharmacyPartnerApplication_contactEmail_idx" ON "PharmacyPartnerApplication"("contactEmail");
CREATE INDEX "PharmacyPartnerApplication_phone_idx" ON "PharmacyPartnerApplication"("phone");
CREATE INDEX "PharmacyPartnerApplication_licenseNumber_idx" ON "PharmacyPartnerApplication"("licenseNumber");
CREATE UNIQUE INDEX "PharmacyPartnerApplication_active_email_key" ON "PharmacyPartnerApplication"(LOWER("contactEmail")) WHERE "status" <> 'REJECTED';
CREATE UNIQUE INDEX "PharmacyPartnerApplication_active_phone_key" ON "PharmacyPartnerApplication"("phone") WHERE "status" <> 'REJECTED';
CREATE UNIQUE INDEX "PharmacyPartnerApplication_active_license_key" ON "PharmacyPartnerApplication"(LOWER("licenseNumber")) WHERE "status" <> 'REJECTED';
CREATE UNIQUE INDEX "PharmacyFieldVisitVerification_applicationId_key" ON "PharmacyFieldVisitVerification"("applicationId");
CREATE INDEX "PharmacyFieldVisitVerification_verifierAdminId_idx" ON "PharmacyFieldVisitVerification"("verifierAdminId");
CREATE INDEX "PharmacyFieldVisitVerification_result_idx" ON "PharmacyFieldVisitVerification"("result");
CREATE UNIQUE INDEX "RiderPartnerApplication_approvedUserId_key" ON "RiderPartnerApplication"("approvedUserId");
CREATE INDEX "RiderPartnerApplication_status_submittedAt_idx" ON "RiderPartnerApplication"("status", "submittedAt");
CREATE INDEX "RiderPartnerApplication_email_idx" ON "RiderPartnerApplication"("email");
CREATE INDEX "RiderPartnerApplication_phone_idx" ON "RiderPartnerApplication"("phone");
CREATE INDEX "RiderPartnerApplication_drivingLicenseNumber_idx" ON "RiderPartnerApplication"("drivingLicenseNumber");
CREATE UNIQUE INDEX "RiderPartnerApplication_active_email_key" ON "RiderPartnerApplication"(LOWER("email")) WHERE "status" <> 'REJECTED';
CREATE UNIQUE INDEX "RiderPartnerApplication_active_phone_key" ON "RiderPartnerApplication"("phone") WHERE "status" <> 'REJECTED';
CREATE UNIQUE INDEX "RiderPartnerApplication_active_license_key" ON "RiderPartnerApplication"(LOWER("drivingLicenseNumber")) WHERE "status" <> 'REJECTED' AND "drivingLicenseNumber" IS NOT NULL;
CREATE UNIQUE INDEX "RiderOfficeVerification_applicationId_key" ON "RiderOfficeVerification"("applicationId");
CREATE INDEX "RiderOfficeVerification_verifierAdminId_idx" ON "RiderOfficeVerification"("verifierAdminId");
CREATE INDEX "RiderOfficeVerification_result_idx" ON "RiderOfficeVerification"("result");

ALTER TABLE "PharmacyPartnerApplication" ADD CONSTRAINT "PharmacyPartnerApplication_approvedUserId_fkey" FOREIGN KEY ("approvedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PharmacyPartnerApplication" ADD CONSTRAINT "PharmacyPartnerApplication_approvedPharmacyId_fkey" FOREIGN KEY ("approvedPharmacyId") REFERENCES "Pharmacy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PharmacyFieldVisitVerification" ADD CONSTRAINT "PharmacyFieldVisitVerification_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PharmacyPartnerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PharmacyFieldVisitVerification" ADD CONSTRAINT "PharmacyFieldVisitVerification_verifierAdminId_fkey" FOREIGN KEY ("verifierAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiderPartnerApplication" ADD CONSTRAINT "RiderPartnerApplication_approvedUserId_fkey" FOREIGN KEY ("approvedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RiderOfficeVerification" ADD CONSTRAINT "RiderOfficeVerification_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RiderPartnerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderOfficeVerification" ADD CONSTRAINT "RiderOfficeVerification_verifierAdminId_fkey" FOREIGN KEY ("verifierAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
