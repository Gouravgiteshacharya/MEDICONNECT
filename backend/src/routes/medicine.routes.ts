import { Router } from "express";

import {
  getMedicine,
  getMedicines,
} from "../controllers/medicine.controller.js";
import { getMedicineAvailability } from "../controllers/medicineAvailability.controller.js";
import { getMedicineAlternatives } from "../controllers/medicineAlternatives.controller.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  medicineListQuerySchema,
  medicineParamsSchema,
} from "../validators/medicine.schemas.js";
import { medicineAvailabilityQuerySchema } from "../validators/medicineAvailability.schemas.js";
import { medicineAlternativesQuerySchema } from "../validators/medicineAlternatives.schemas.js";

export const medicineRoutes = Router();

medicineRoutes.get(
  "/",
  validateRequest({ query: medicineListQuerySchema }),
  getMedicines,
);
medicineRoutes.get(
  "/:medicineId/alternatives",
  validateRequest({
    params: medicineParamsSchema,
    query: medicineAlternativesQuerySchema,
  }),
  getMedicineAlternatives,
);
medicineRoutes.get(
  "/:medicineId/availability",
  validateRequest({
    params: medicineParamsSchema,
    query: medicineAvailabilityQuerySchema,
  }),
  getMedicineAvailability,
);
medicineRoutes.get(
  "/:medicineId",
  validateRequest({ params: medicineParamsSchema }),
  getMedicine,
);
