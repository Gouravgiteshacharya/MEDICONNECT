import cors from "cors";
import express, { type Express } from "express";
import type { Authenticator } from "./auth/authenticator.js";
import { unconfiguredAuthenticator } from "./auth/authenticator.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { createRiderRouter } from "./riders/rider.routes.js";
import type { RiderStore } from "./riders/rider.service.js";
import type { LocationStore } from "./location/location.service.js";
import { loadLocationConfig, type LocationConfig } from "./location/config.js";
import { createDeliveryQuoteRouter } from "./delivery-quotes/delivery-quote.routes.js";
import { loadDeliveryQuoteConfig, type DeliveryQuoteConfig } from "./delivery-quotes/delivery-quote.config.js";
import type { DeliveryQuoteStore } from "./delivery-quotes/delivery-quote.service.js";
import { HaversineDistanceProvider, type DistanceProvider } from "./delivery-quotes/distance-provider.js";
import { createAssignmentRouter } from "./delivery-assignments/assignment.routes.js";
import { loadAssignmentConfig, type AssignmentConfig } from "./delivery-assignments/assignment.config.js";
import type { AssignmentStore } from "./delivery-assignments/assignment.service.js";
export interface AppDependencies {
  store: RiderStore;
  authenticate?: Authenticator;
  locationConfig?: LocationConfig;
  deliveryQuoteConfig?: DeliveryQuoteConfig;
  distanceProvider?: DistanceProvider;
  assignmentConfig?: AssignmentConfig;
  now?: () => Date;
}
export function createApp({
  store,
  authenticate = unconfiguredAuthenticator,
  locationConfig = loadLocationConfig(),
  deliveryQuoteConfig = loadDeliveryQuoteConfig(),
  distanceProvider = new HaversineDistanceProvider(),
  assignmentConfig = loadAssignmentConfig(),
  now = () => new Date(),
}: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json());
  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/v1/riders", createRiderRouter(store as RiderStore & LocationStore, authenticate, { sampleIntervalMs: locationConfig.sampleIntervalMs, now }));
  app.use("/api/v1/delivery-quotes", createDeliveryQuoteRouter(store as RiderStore & DeliveryQuoteStore, authenticate, {
    config: deliveryQuoteConfig, distanceProvider, now,
  }));
  app.use("/api/v1/delivery-assignments", createAssignmentRouter(store as unknown as AssignmentStore, authenticate, {
    ...assignmentConfig, freshnessThresholdMs: locationConfig.freshnessThresholdMs, now,
  }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
