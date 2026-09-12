import type { EtaShadowDependencies } from "../ml/eta-runtime.js";
import { Router } from "express";

import { authRoutes } from "./auth.routes.js";
import { cartRoutes } from "./cart.routes.js";
import { healthRoutes } from "./health.routes.js";
import { medicineRoutes } from "./medicine.routes.js";
import { createOrderRoutes } from "./order.routes.js";
import { pharmacyRoutes } from "./pharmacy.routes.js";
import { userRoutes } from "./user.routes.js";

export function createApiRoutes(dependencies: EtaShadowDependencies = {}) {
  const apiRoutes = Router();

  apiRoutes.use("/auth", authRoutes);
  apiRoutes.use("/cart", cartRoutes);
  apiRoutes.use("/health", healthRoutes);
  apiRoutes.use("/medicines", medicineRoutes);
  apiRoutes.use("/orders", createOrderRoutes(dependencies));
  apiRoutes.use("/pharmacies", pharmacyRoutes);
  apiRoutes.use("/users", userRoutes);

  return apiRoutes;
}
export const apiRoutes = createApiRoutes();
