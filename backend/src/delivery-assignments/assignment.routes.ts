import { Router } from "express";
import type { Authenticator } from "../auth/authenticator.js";
import { requireAuthentication, requireRole } from "../middleware/authorization.js";
import type { AssignmentOptions, AssignmentStore } from "./assignment.service.js";
import { acceptAssignmentOffer, createAssignmentOffer, declineAssignmentOffer, listMyOffers } from "./assignment.service.js";
import { parseAssignmentId, parseCreateOfferInput, requireEmptyBody } from "./assignment.validation.js";

export function createAssignmentRouter(store: AssignmentStore, authenticate: Authenticator, options: AssignmentOptions): Router {
  const router = Router();
  router.post("/offers", authenticate, requireAuthentication, requireRole("ADMIN"), async (req, res) => {
    res.status(201).json({ data: await createAssignmentOffer(store, parseCreateOfferInput(req.body), options) });
  });
  router.get("/offers/me", authenticate, requireAuthentication, requireRole("DELIVERY_PARTNER"), async (req, res) => {
    res.json({ data: await listMyOffers(store, req.auth!.userId, options) });
  });
  router.post("/:assignmentId/accept", authenticate, requireAuthentication, requireRole("DELIVERY_PARTNER"), async (req, res) => {
    requireEmptyBody(req.body); res.json({ data: await acceptAssignmentOffer(store, req.auth!.userId, parseAssignmentId(req.params.assignmentId), options) });
  });
  router.post("/:assignmentId/decline", authenticate, requireAuthentication, requireRole("DELIVERY_PARTNER"), async (req, res) => {
    requireEmptyBody(req.body); res.json({ data: await declineAssignmentOffer(store, req.auth!.userId, parseAssignmentId(req.params.assignmentId), options) });
  });
  return router;
}
