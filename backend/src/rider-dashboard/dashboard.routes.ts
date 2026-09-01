import { Router } from "express";
import type { Authenticator } from "../auth/authenticator.js";
import { requireAuthentication, requireRole } from "../middleware/authorization.js";
import type { DashboardOptions, DashboardStore } from "./dashboard.service.js";
import { getRiderDashboard } from "./dashboard.service.js";
export function createDashboardRouter(store: DashboardStore, authenticate: Authenticator, options: DashboardOptions): Router {
  const router = Router();
  router.get("/me/dashboard", authenticate, requireAuthentication, requireRole("DELIVERY_PARTNER"), async (req, res) => res.json({ data: await getRiderDashboard(store, req.user!.id, options) }));
  return router;
}
