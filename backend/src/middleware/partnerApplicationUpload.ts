import multer from "multer";
import type { RequestHandler } from "express";

import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: env.prescriptionMaxFileBytes },
});

export const parsePharmacyPhoto: RequestHandler = (req, res, next) => {
  upload.single("photo")(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return next(new ApiError(413, "Pharmacy photo is too large.", "PARTNER_PHOTO_TOO_LARGE"));
    }
    return next(new ApiError(400, "Invalid pharmacy photo upload.", "PARTNER_PHOTO_INVALID"));
  });
};

export const parseRiderIdentityDocument: RequestHandler = (req, res, next) => {
  upload.single("identityDocument")(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return next(new ApiError(413, "Identity document is too large.", "RIDER_IDENTITY_DOCUMENT_TOO_LARGE"));
    }
    return next(new ApiError(400, "Invalid identity document upload.", "RIDER_IDENTITY_DOCUMENT_INVALID"));
  });
};
