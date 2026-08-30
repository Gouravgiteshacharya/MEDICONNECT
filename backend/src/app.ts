import cors from "cors";
import express, { type Express } from "express";
import type { Authenticator } from "./auth/authenticator.js";
import { unconfiguredAuthenticator } from "./auth/authenticator.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { createRiderRouter } from "./riders/rider.routes.js";
import type { RiderStore } from "./riders/rider.service.js";
import type { LocationStore } from "./location/location.service.js";
import { loadLocationConfig, type LocationConfig } from "./location/config.js";
export interface AppDependencies { store: RiderStore; authenticate?: Authenticator; locationConfig?: LocationConfig; now?: () => Date; }
export function createApp({ store, authenticate = unconfiguredAuthenticator, locationConfig = loadLocationConfig(), now = () => new Date() }: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json());
  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/v1/riders", createRiderRouter(store as RiderStore & LocationStore, authenticate, { sampleIntervalMs: locationConfig.sampleIntervalMs, now }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
