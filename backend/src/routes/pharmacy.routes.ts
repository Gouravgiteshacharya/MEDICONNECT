import { UserRole } from "../../generated/prisma/client.js";
import { Router } from "express";

import {
  getOperationalProfile,
  getPublicProfile,
  updateOperationalProfile,
} from "../controllers/pharmacy.controller.js";
import {
  createInventoryItem,
  getInventoryItem,
  listInventory,
  updateInventoryItem,
} from "../controllers/inventory.controller.js";
import { getDashboard } from "../controllers/pharmacyDashboard.controller.js";
import {
  decideOrder,
  reviewPrescription,
} from "../controllers/pharmacyWorkflow.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  createInventorySchema,
  inventoryListQuerySchema,
  inventoryParamsSchema,
  updateInventorySchema,
} from "../validators/inventory.schemas.js";
import {
  pharmacyParamsSchema,
  updatePharmacyProfileSchema,
} from "../validators/pharmacy.schemas.js";
import { pharmacyDashboardQuerySchema } from "../validators/pharmacyDashboard.schemas.js";
import {
  decideOrderSchema,
  orderDecisionParamsSchema,
  prescriptionReviewParamsSchema,
  reviewPrescriptionSchema,
} from "../validators/pharmacyWorkflow.schemas.js";

export const pharmacyRoutes = Router();

const inventoryAccess = [
  authenticate,
  authorizeRoles(UserRole.PHARMACY_STAFF),
] as const;

pharmacyRoutes.patch(
  "/:pharmacyId/prescriptions/:prescriptionId/review",
  validateRequest({ params: prescriptionReviewParamsSchema }),
  authenticate,
  authorizeRoles(UserRole.PHARMACY_STAFF),
  validateRequest(reviewPrescriptionSchema),
  reviewPrescription,
);

pharmacyRoutes.patch(
  "/:pharmacyId/orders/:orderId/decision",
  validateRequest({ params: orderDecisionParamsSchema }),
  authenticate,
  authorizeRoles(UserRole.PHARMACY_STAFF),
  validateRequest(decideOrderSchema),
  decideOrder,
);

pharmacyRoutes.get(
  "/:pharmacyId/dashboard",
  validateRequest({
    params: pharmacyParamsSchema,
    query: pharmacyDashboardQuerySchema,
  }),
  authenticate,
  authorizeRoles(UserRole.PHARMACY_STAFF),
  getDashboard,
);

pharmacyRoutes.get(
  "/:pharmacyId/inventory",
  validateRequest({ params: inventoryParamsSchema, query: inventoryListQuerySchema }),
  ...inventoryAccess,
  listInventory,
);
pharmacyRoutes.get(
  "/:pharmacyId/inventory/:inventoryId",
  validateRequest({ params: inventoryParamsSchema }),
  ...inventoryAccess,
  getInventoryItem,
);
pharmacyRoutes.post(
  "/:pharmacyId/inventory",
  validateRequest({ params: inventoryParamsSchema }),
  ...inventoryAccess,
  validateRequest(createInventorySchema),
  createInventoryItem,
);
pharmacyRoutes.patch(
  "/:pharmacyId/inventory/:inventoryId",
  validateRequest({ params: inventoryParamsSchema }),
  ...inventoryAccess,
  validateRequest(updateInventorySchema),
  updateInventoryItem,
);

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
