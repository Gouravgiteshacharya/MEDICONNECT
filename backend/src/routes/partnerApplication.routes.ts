import { Router } from "express";

import { createPharmacyApplication, createRiderApplication } from "../controllers/partnerApplication.controller.js";
import { parsePharmacyPhoto } from "../middleware/partnerApplicationUpload.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { pharmacyApplicationSchema, riderApplicationSchema } from "../validators/partnerApplication.schemas.js";

export const partnerApplicationRoutes = Router();

partnerApplicationRoutes.post(
  "/pharmacy/apply",
  parsePharmacyPhoto,
  validateRequest(pharmacyApplicationSchema),
  createPharmacyApplication,
);
partnerApplicationRoutes.post(
  "/rider/apply",
  validateRequest(riderApplicationSchema),
  createRiderApplication,
);
