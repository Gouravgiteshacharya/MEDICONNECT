import multer from "multer";
import type { RequestHandler } from "express";

import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: env.prescriptionMaxFileBytes,
  },
});

export const parsePrescriptionUpload: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (
      error instanceof multer.MulterError &&
      error.code === "LIMIT_FILE_SIZE"
    ) {
      next(
        new ApiError(
          413,
          "Prescription document is too large.",
          "PRESCRIPTION_FILE_TOO_LARGE",
        ),
      );
      return;
    }

    next(
      new ApiError(
        400,
        "Invalid prescription document upload.",
        "PRESCRIPTION_FILE_INVALID",
      ),
    );
  });
};
