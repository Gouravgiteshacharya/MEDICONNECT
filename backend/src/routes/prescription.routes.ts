import { Router } from "express";
import { UserRole } from "../../generated/prisma/client.js";

import {
  getPrescription,
  getPrescriptionDocumentAccess,
  listPrescriptionLibrary,
} from "../controllers/prescription.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  prescriptionLibraryQuerySchema,
  prescriptionParamsSchema,
} from "../validators/prescription.schemas.js";

export const prescriptionRoutes = Router();

prescriptionRoutes.use(authenticate);

prescriptionRoutes.get(
  "/",
  authorizeRoles(UserRole.CUSTOMER),
  validateRequest({ query: prescriptionLibraryQuerySchema }),
  listPrescriptionLibrary,
);

prescriptionRoutes.get(
  "/:prescriptionId/document-access",
  validateRequest({ params: prescriptionParamsSchema }),
  getPrescriptionDocumentAccess,
);

prescriptionRoutes.get(
  "/:prescriptionId",
  authorizeRoles(UserRole.CUSTOMER),
  validateRequest({ params: prescriptionParamsSchema }),
  getPrescription,
);
