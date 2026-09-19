-- Partner onboarding refinement: explicit GST declaration and private rider ID metadata.

CREATE TYPE "RiderIdentityDocumentType" AS ENUM (
  'AADHAAR',
  'VOTER_ID',
  'DRIVING_LICENCE',
  'PASSPORT',
  'OTHER_GOVERNMENT_ID'
);

ALTER TABLE "PharmacyPartnerApplication"
  ADD COLUMN "gstRegistered" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "RiderPartnerApplication"
  ADD COLUMN "identityDocumentType" "RiderIdentityDocumentType",
  ADD COLUMN "identityDocumentStoragePath" TEXT,
  ADD COLUMN "identityDocumentOriginalFilename" TEXT,
  ADD COLUMN "identityDocumentMimeType" TEXT,
  ADD COLUMN "identityDocumentUploadedAt" TIMESTAMP(3);
