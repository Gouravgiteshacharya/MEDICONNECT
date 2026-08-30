import { Router } from "express";
import type { Authenticator } from "../auth/authenticator.js";
import { requireAuthentication, requireRole } from "../middleware/authorization.js";
import { ApiError } from "../middleware/errors.js";
import { getRiderProfile, MANUAL_AVAILABILITIES, setRiderAvailability, type ManualAvailability, type RiderStore } from "./rider.service.js";
export function createRiderRouter(store: RiderStore, authenticate: Authenticator): Router {
  const router = Router();
  router.use(authenticate, requireAuthentication, requireRole("DELIVERY_PARTNER"));
  router.get("/me", async (req, res) => res.json({ data: await getRiderProfile(store, req.auth!.userId) }));
  router.patch("/me/availability", async (req, res) => {
    const availability = req.body?.availability;
    if (typeof availability !== "string" || !MANUAL_AVAILABILITIES.includes(availability as ManualAvailability)) {
      throw new ApiError(400, `availability must be one of: ${MANUAL_AVAILABILITIES.join(", ")}`, "INVALID_AVAILABILITY");
    }
    res.json({ data: await setRiderAvailability(store, req.auth!.userId, availability as ManualAvailability) });
  });
  return router;
}
