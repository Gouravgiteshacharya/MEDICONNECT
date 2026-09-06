import { Router } from "express";
import type { Authenticator } from "../auth/authenticator.js";
import { requireAuthentication, requireRole } from "../middleware/authorization.js";
import type { TrackingOptions, TrackingStore } from "./tracking.service.js";
import { getCustomerTracking } from "./tracking.service.js";
import { parseTrackingOrderId } from "./tracking.validation.js";
export function createTrackingRouter(store: TrackingStore, authenticate: Authenticator, options: TrackingOptions): Router {
  const router = Router();
  router.get("/:orderId/tracking", authenticate, requireAuthentication, requireRole("CUSTOMER"), async (req, res) => {
    res.json({ data: await getCustomerTracking(store, req.user!.id, parseTrackingOrderId(req.params.orderId), options) });
  });
  return router;
}
