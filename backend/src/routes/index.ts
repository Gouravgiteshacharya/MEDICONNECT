import { Router } from "express";

import { authRoutes } from "./auth.routes.js";
import { cartRoutes } from "./cart.routes.js";
import { healthRoutes } from "./health.routes.js";
import { userRoutes } from "./user.routes.js";

export const apiRoutes = Router();

apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/cart", cartRoutes);
apiRoutes.use("/health", healthRoutes);
apiRoutes.use("/users", userRoutes);
