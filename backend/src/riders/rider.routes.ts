import { Router } from "express";
import type { Authenticator } from "../auth/authenticator.js";
import { requireAuthentication, requireRole } from "../middleware/authorization.js";
import { ApiError } from "../middleware/errors.js";
import type { LocationStore } from "../location/location.service.js";
import { updateRiderLocation } from "../location/location.service.js";
import { parseLocationInput } from "../location/location.validation.js";
import { getRiderProfile, MANUAL_AVAILABILITIES, setRiderAvailability, type ManualAvailability, type RiderStore } from "./rider.service.js";
export interface RiderRouterOptions { sampleIntervalMs: number; now: () => Date; }
export function createRiderRouter(store: RiderStore & LocationStore, authenticate: Authenticator, options: RiderRouterOptions): Router {
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
  router.patch("/me/location", async (req, res) => {
    const result = await updateRiderLocation(store, req.auth!.userId, parseLocationInput(req.body), options);
    res.json({ data: { rider: result.rider, historyRecorded: result.historyRecorded } });
  });
  return router;
}
