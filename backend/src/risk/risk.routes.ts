import { Router } from "express";
import type { Authenticator } from "../auth/authenticator.js";
import { requireAuthentication, requireRole } from "../middleware/authorization.js";
import { ApiError } from "../utils/ApiError.js";
import { createRiskController, type AdminRiskService } from "./risk.controller.js";

function isAdminRiskService(value: unknown): value is AdminRiskService {
  return typeof value === "object" && value !== null &&
    ["getAdminById", "listAdminOpen", "getById", "acknowledgeAssessment", "resolveAssessment", "dismissAssessment"].every(key => typeof (value as Record<string, unknown>)[key] === "function");
}

/** Accepts optional/partial app dependencies without constructing persistence infrastructure. */
export function createRiskRouter(authenticate: Authenticator, riskService: unknown, now: () => Date): Router {
  const router = Router();
  router.use(authenticate, requireAuthentication, requireRole("ADMIN"));
  const controller = createRiskController(() => {
    if (!isAdminRiskService(riskService)) throw new ApiError(503, "Risk service is unavailable.", "RISK_SERVICE_UNAVAILABLE");
    return riskService;
  }, now);
  router.get("/", controller.list);
  router.get("/:id", controller.detail);
  router.post("/:id/acknowledge", controller.acknowledge);
  router.post("/:id/resolve", controller.resolve);
  router.post("/:id/dismiss", controller.dismiss);
  return router;
}
