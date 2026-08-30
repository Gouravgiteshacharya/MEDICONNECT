import cors from "cors";
import express, { type Express } from "express";
import type { Authenticator } from "./auth/authenticator.js";
import { unconfiguredAuthenticator } from "./auth/authenticator.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { createRiderRouter } from "./riders/rider.routes.js";
import type { RiderStore } from "./riders/rider.service.js";
export interface AppDependencies { store: RiderStore; authenticate?: Authenticator; }
export function createApp({ store, authenticate = unconfiguredAuthenticator }: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json());
  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/v1/riders", createRiderRouter(store, authenticate));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
