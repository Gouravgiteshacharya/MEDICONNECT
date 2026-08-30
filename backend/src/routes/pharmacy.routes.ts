import { UserRole } from "../../generated/prisma/client.js";
import { Router } from "express";

import {
  getOperationalProfile,
  getPublicProfile,
  updateOperationalProfile,
} from "../controllers/pharmacy.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  pharmacyParamsSchema,
  updatePharmacyProfileSchema,
} from "../validators/pharmacy.schemas.js";

export const pharmacyRoutes = Router();

pharmacyRoutes.get(
  "/:pharmacyId/profile",
  validateRequest({ params: pharmacyParamsSchema }),
  authenticate,
  authorizeRoles(UserRole.PHARMACY_STAFF),
  getOperationalProfile,
);
pharmacyRoutes.patch(
  "/:pharmacyId/profile",
  validateRequest({ params: pharmacyParamsSchema }),
  authenticate,
  authorizeRoles(UserRole.PHARMACY_STAFF),
  validateRequest(updatePharmacyProfileSchema),
  updateOperationalProfile,
);
pharmacyRoutes.get(
  "/:pharmacyId",
  validateRequest({ params: pharmacyParamsSchema }),
  getPublicProfile,
);
