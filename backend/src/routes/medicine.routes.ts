import { Router } from "express";

import {
  getMedicine,
  getMedicines,
} from "../controllers/medicine.controller.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  medicineListQuerySchema,
  medicineParamsSchema,
} from "../validators/medicine.schemas.js";

export const medicineRoutes = Router();

medicineRoutes.get(
  "/",
  validateRequest({ query: medicineListQuerySchema }),
  getMedicines,
);
medicineRoutes.get(
  "/:medicineId",
  validateRequest({ params: medicineParamsSchema }),
  getMedicine,
);
