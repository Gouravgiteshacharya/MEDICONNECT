import type { EtaShadowDependencies } from "../ml/eta-runtime.js";
import type { AssistantResponder } from "../modules/intelligence-experience/contracts.js";
import { Router, type RequestHandler } from "express";
import { createAssistantRoutes } from "./assistant.routes.js";

import { authRoutes } from "./auth.routes.js";
import { adminRoutes } from "./admin.routes.js";
import { cartRoutes } from "./cart.routes.js";
import { healthRoutes } from "./health.routes.js";
import { medicineRoutes } from "./medicine.routes.js";
import { createOrderRoutes } from "./order.routes.js";
import { pharmacyRoutes } from "./pharmacy.routes.js";
import { userRoutes } from "./user.routes.js";

export interface ApiRouteDependencies extends EtaShadowDependencies {
  readonly authenticate: RequestHandler;
  readonly assistant?: AssistantResponder;
}

export function createApiRoutes(dependencies: ApiRouteDependencies) {
  const apiRoutes = Router();

  apiRoutes.use("/admin", adminRoutes);
  apiRoutes.use(
    "/assistant",
    createAssistantRoutes(dependencies.authenticate, dependencies.assistant),
  );

  apiRoutes.use("/auth", authRoutes);
  apiRoutes.use("/cart", cartRoutes);
  apiRoutes.use("/health", healthRoutes);
  apiRoutes.use("/medicines", medicineRoutes);
  apiRoutes.use("/orders", createOrderRoutes(dependencies));
  apiRoutes.use("/pharmacies", pharmacyRoutes);
  apiRoutes.use("/users", userRoutes);

  return apiRoutes;
}
