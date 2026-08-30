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

export const pharmacyRoutes = Router();

const inventoryAccess = [
  authenticate,
  authorizeRoles(UserRole.PHARMACY_STAFF),
] as const;

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
