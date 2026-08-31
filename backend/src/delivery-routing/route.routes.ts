import { Router } from "express";
import type { Authenticator } from "../auth/authenticator.js";
import { requireAuthentication, requireRole } from "../middleware/authorization.js";
import type { RouteOptions, RouteStore } from "./route.service.js";
import { getMyBatchRoute, optimizeBatchRoute } from "./route.service.js";
import { parseBatchId } from "./route.validation.js";

export function createRouteRouter(store: RouteStore, authenticate: Authenticator, options: RouteOptions): Router {
  const router = Router();
  router.post("/:batchId/optimize", authenticate, requireAuthentication, requireRole("ADMIN"), async (req, res) => res.json({ data: await optimizeBatchRoute(store, parseBatchId(req.params.batchId), options) }));
  router.get("/:batchId/route/me", authenticate, requireAuthentication, requireRole("DELIVERY_PARTNER"), async (req, res) => res.json({ data: await getMyBatchRoute(store, parseBatchId(req.params.batchId), req.auth!.userId) }));
  return router;
}
