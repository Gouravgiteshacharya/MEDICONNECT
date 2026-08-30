import { Router } from "express";
import { UserRole } from "../../generated/prisma/client.js";

import { createOrder } from "../controllers/order.controller.js";
import {
  createPrescription,
  listPrescriptions,
} from "../controllers/prescription.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { createOrderSchema } from "../validators/order.schemas.js";
import {
  createPrescriptionSchema,
  prescriptionOrderParamsSchema,
} from "../validators/prescription.schemas.js";

export const orderRoutes = Router();

orderRoutes.use(authenticate, authorizeRoles(UserRole.CUSTOMER));
orderRoutes.post("/", validateRequest(createOrderSchema), createOrder);
orderRoutes.post(
  "/:orderId/prescriptions",
  validateRequest({ params: prescriptionOrderParamsSchema }),
  validateRequest(createPrescriptionSchema),
  createPrescription,
);
orderRoutes.get(
  "/:orderId/prescriptions",
  validateRequest({ params: prescriptionOrderParamsSchema }),
  listPrescriptions,
);
