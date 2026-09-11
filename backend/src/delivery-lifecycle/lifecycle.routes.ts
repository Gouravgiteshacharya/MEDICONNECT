import { Router } from "express";
import type { Authenticator } from "../auth/authenticator.js";
import { requireAuthentication, requireRole } from "../middleware/authorization.js";
import type { LifecycleOptions, LifecycleStore } from "./lifecycle.service.js";
import { failDelivery, transitionLifecycle } from "./lifecycle.service.js";
import { parseFailureBody, parseLifecycleAssignmentId, requireEmptyLifecycleBody } from "./lifecycle.validation.js";
export function createLifecycleRouter(store: LifecycleStore, authenticate: Authenticator, options: LifecycleOptions): Router {
  const router = Router();
  const action = (path: string, value: "ARRIVE_PHARMACY" | "PICKUP" | "START_DELIVERY" | "DELIVER") => router.post(`/:assignmentId/${path}`, authenticate, requireAuthentication, requireRole("DELIVERY_PARTNER"), async (req, res) => {
    requireEmptyLifecycleBody(req.body); res.json({ data: await transitionLifecycle(store, req.user!.id, parseLifecycleAssignmentId(req.params.assignmentId), value, options) });
  });
  action("arrive-pharmacy", "ARRIVE_PHARMACY"); action("pickup", "PICKUP"); action("start-delivery", "START_DELIVERY"); action("deliver", "DELIVER");
  router.post("/:assignmentId/fail", authenticate, requireAuthentication, requireRole("DELIVERY_PARTNER"), async (req, res) => {
    const input = parseFailureBody(req.body); res.json({ data: await failDelivery(store, req.user!.id, parseLifecycleAssignmentId(req.params.assignmentId), input.reason, options) });
  });
  return router;
}
