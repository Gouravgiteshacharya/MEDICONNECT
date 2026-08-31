import { Router } from "express";
import type { Authenticator } from "../auth/authenticator.js";
import { requireAuthentication, requireRole } from "../middleware/authorization.js";
import type { DispatchOptions, DispatchStore } from "./dispatch.service.js";
import { dispatchOrder } from "./dispatch.service.js";
import { parseDispatchOrderId, requireEmptyDispatchBody } from "./dispatch.validation.js";
export function createDispatchRouter(store: DispatchStore, authenticate: Authenticator, options: DispatchOptions): Router {
  const router = Router();
  router.post("/orders/:orderId", authenticate, requireAuthentication, requireRole("ADMIN"), async (req, res) => {
    requireEmptyDispatchBody(req.body);
    res.status(201).json({ data: await dispatchOrder(store, parseDispatchOrderId(req.params.orderId), options) });
  });
  return router;
}
