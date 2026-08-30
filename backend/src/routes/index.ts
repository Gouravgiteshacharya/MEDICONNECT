import { Router } from "express";

import { authRoutes } from "./auth.routes.js";
import { cartRoutes } from "./cart.routes.js";
import { healthRoutes } from "./health.routes.js";
import { medicineRoutes } from "./medicine.routes.js";
import { pharmacyRoutes } from "./pharmacy.routes.js";
import { userRoutes } from "./user.routes.js";

export const apiRoutes = Router();

apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/cart", cartRoutes);
apiRoutes.use("/health", healthRoutes);
apiRoutes.use("/medicines", medicineRoutes);
apiRoutes.use("/pharmacies", pharmacyRoutes);
apiRoutes.use("/users", userRoutes);
