import { Router } from "express";
import { UserRole } from "../../generated/prisma/client.js";
import { getPharmacy, listInventory, listPharmacies } from "../controllers/admin.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { adminInventoryListSchema, adminPharmacyListSchema } from "../validators/admin.schemas.js";
import { pharmacyParamsSchema } from "../validators/pharmacy.schemas.js";

export const adminRoutes = Router();
adminRoutes.use(authenticate, authorizeRoles(UserRole.ADMIN));
adminRoutes.get("/pharmacies", validateRequest({ query: adminPharmacyListSchema }), listPharmacies);
adminRoutes.get("/pharmacies/:pharmacyId", validateRequest({ params: pharmacyParamsSchema }), getPharmacy);
adminRoutes.get("/inventory", validateRequest({ query: adminInventoryListSchema }), listInventory);
