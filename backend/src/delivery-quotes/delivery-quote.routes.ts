import { Router } from "express";
import type { Authenticator } from "../auth/authenticator.js";
import { requireAuthentication, requireRole } from "../middleware/authorization.js";
import type { DeliveryQuoteConfig } from "./delivery-quote.config.js";
import { createDeliveryQuote, type DeliveryQuoteStore } from "./delivery-quote.service.js";
import { parseDeliveryQuoteInput } from "./delivery-quote.validation.js";
import type { DistanceProvider } from "./distance-provider.js";

export function createDeliveryQuoteRouter(
  store: DeliveryQuoteStore,
  authenticate: Authenticator,
  options: { config: DeliveryQuoteConfig; distanceProvider: DistanceProvider; now: () => Date },
): Router {
  const router = Router();
  router.use(authenticate, requireAuthentication, requireRole("CUSTOMER"));
  router.post("/", async (request, response) => {
    const quote = await createDeliveryQuote(store, request.auth!.userId, parseDeliveryQuoteInput(request.body), options);
    response.status(201).json({ data: quote });
  });
  return router;
}
