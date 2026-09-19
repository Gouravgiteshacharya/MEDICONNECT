import { Router } from "express";
import { getOperationsSummary } from "../controllers/admin.controller.js";
import { getOrder, listOrders } from "../controllers/admin.controller.js";
import { adminOrderListSchema } from "../validators/admin.schemas.js";
import { orderParamsSchema } from "../validators/order.schemas.js";
import { UserRole } from "../../generated/prisma/client.js";
import { getPharmacy, listInventory, listPharmacies } from "../controllers/admin.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { adminInventoryListSchema, adminPharmacyListSchema } from "../validators/admin.schemas.js";
import { pharmacyParamsSchema } from "../validators/pharmacy.schemas.js";
import {
  adminApprovePharmacyApplication,
  adminApproveRiderApplication,
  adminGetPharmacyApplication,
  adminGetPharmacyPhotoAccess,
  adminGetRiderApplication,
  adminListPharmacyApplications,
  adminListRiderApplications,
  adminRecordFieldVisit,
  adminRecordOfficeVerification,
  adminTransitionPharmacyApplication,
  adminTransitionRiderApplication,
} from "../controllers/partnerApplication.controller.js";
import {
  applicationParamsSchema,
  fieldVisitSchema,
  officeVerificationSchema,
  pharmacyApplicationListSchema,
  pharmacyTransitionSchema,
  riderApplicationListSchema,
  riderTransitionSchema,
} from "../validators/partnerApplication.schemas.js";

export const adminRoutes = Router();
adminRoutes.use(authenticate, authorizeRoles(UserRole.ADMIN));
adminRoutes.get("/pharmacies", validateRequest({ query: adminPharmacyListSchema }), listPharmacies);
adminRoutes.get("/pharmacies/:pharmacyId", validateRequest({ params: pharmacyParamsSchema }), getPharmacy);
adminRoutes.get("/inventory", validateRequest({ query: adminInventoryListSchema }), listInventory);
adminRoutes.get("/orders", validateRequest({ query: adminOrderListSchema }), listOrders);
adminRoutes.get("/orders/:orderId", validateRequest({ params: orderParamsSchema }), getOrder);
adminRoutes.get("/operations/summary", getOperationsSummary);
adminRoutes.get("/applications/pharmacies", validateRequest({ query: pharmacyApplicationListSchema }), adminListPharmacyApplications);
adminRoutes.get("/applications/pharmacies/:applicationId", validateRequest({ params: applicationParamsSchema }), adminGetPharmacyApplication);
adminRoutes.get("/applications/pharmacies/:applicationId/photo-access", validateRequest({ params: applicationParamsSchema }), adminGetPharmacyPhotoAccess);
adminRoutes.patch("/applications/pharmacies/:applicationId/status", validateRequest({ params: applicationParamsSchema, body: pharmacyTransitionSchema }), adminTransitionPharmacyApplication);
adminRoutes.put("/applications/pharmacies/:applicationId/field-visit", validateRequest({ params: applicationParamsSchema, body: fieldVisitSchema }), adminRecordFieldVisit);
adminRoutes.post("/applications/pharmacies/:applicationId/approve", validateRequest({ params: applicationParamsSchema }), adminApprovePharmacyApplication);
adminRoutes.get("/applications/riders", validateRequest({ query: riderApplicationListSchema }), adminListRiderApplications);
adminRoutes.get("/applications/riders/:applicationId", validateRequest({ params: applicationParamsSchema }), adminGetRiderApplication);
adminRoutes.patch("/applications/riders/:applicationId/status", validateRequest({ params: applicationParamsSchema, body: riderTransitionSchema }), adminTransitionRiderApplication);
adminRoutes.put("/applications/riders/:applicationId/office-verification", validateRequest({ params: applicationParamsSchema, body: officeVerificationSchema }), adminRecordOfficeVerification);
adminRoutes.post("/applications/riders/:applicationId/approve", validateRequest({ params: applicationParamsSchema }), adminApproveRiderApplication);
