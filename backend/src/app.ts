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
import { createDispatchRouter } from "./dispatch/dispatch.routes.js";
import { loadDispatchConfig, type DispatchConfig } from "./dispatch/dispatch.config.js";
import type { DispatchStore } from "./dispatch/dispatch.service.js";
import { createLifecycleRouter } from "./delivery-lifecycle/lifecycle.routes.js";
import type { LifecycleStore } from "./delivery-lifecycle/lifecycle.service.js";
import { createTrackingRouter } from "./customer-tracking/tracking.routes.js";
import type { TrackingStore } from "./customer-tracking/tracking.service.js";
import { createDashboardRouter } from "./rider-dashboard/dashboard.routes.js";
import type { DashboardStore } from "./rider-dashboard/dashboard.service.js";
import { createBatchRouter } from "./delivery-batches/batch.routes.js";
import { loadBatchConfig, type BatchConfig } from "./delivery-batches/batch.config.js";
import type { BatchStore } from "./delivery-batches/batch.service.js";
import { createRouteRouter } from "./delivery-routing/route.routes.js";
import { loadRouteConfig, type RouteConfig } from "./delivery-routing/route.config.js";
import { HaversineRouteProvider, type RouteProvider } from "./delivery-routing/route-provider.js";
import type { RouteStore } from "./delivery-routing/route.service.js";
import { loadMlConfig, type MlConfig } from "./ml/ml.config.js";
import type { LogisticsModel } from "./ml/logistics-model.js";
export interface AppDependencies {
  store: RiderStore;
  authenticate?: Authenticator;
  locationConfig?: LocationConfig;
  deliveryQuoteConfig?: DeliveryQuoteConfig;
  distanceProvider?: DistanceProvider;
  assignmentConfig?: AssignmentConfig;
  dispatchConfig?: DispatchConfig;
  batchConfig?: BatchConfig;
  routeConfig?: RouteConfig;
  routeProvider?: RouteProvider;
  mlConfig?: MlConfig;
  mlModel?: LogisticsModel | null;
  now?: () => Date;
}
export function createApp({
  store,
  authenticate = unconfiguredAuthenticator,
  locationConfig = loadLocationConfig(),
  deliveryQuoteConfig = loadDeliveryQuoteConfig(),
  distanceProvider = new HaversineDistanceProvider(),
  assignmentConfig = loadAssignmentConfig(),
  dispatchConfig = loadDispatchConfig(),
  batchConfig = loadBatchConfig(),
  routeConfig = loadRouteConfig(),
  routeProvider = new HaversineRouteProvider(routeConfig.assumedSpeedKmh),
  mlConfig = loadMlConfig(),
  mlModel = null,
  now = () => new Date(),
}: AppDependencies): Express {
  const app = express();
  const logisticsModel = mlConfig.enabled ? mlModel : null;
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json());
  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/v1/riders", createDashboardRouter(store as unknown as DashboardStore, authenticate, { freshnessThresholdMs: locationConfig.freshnessThresholdMs, offerTimeoutMs: assignmentConfig.offerTimeoutMs, now }));
  app.use("/api/v1/riders", createRiderRouter(store as RiderStore & LocationStore, authenticate, { sampleIntervalMs: locationConfig.sampleIntervalMs, now }));
  app.use("/api/v1/delivery-quotes", createDeliveryQuoteRouter(store as RiderStore & DeliveryQuoteStore, authenticate, {
    config: deliveryQuoteConfig, distanceProvider, freshnessThresholdMs: locationConfig.freshnessThresholdMs, mlModel: logisticsModel, maxPredictionMinutes: mlConfig.maxPredictionMinutes, fallbackSpeedKmh: mlConfig.fallbackSpeedKmh, timezoneOffsetMinutes: mlConfig.timezoneOffsetMinutes, now,
  }));
  app.use("/api/v1/delivery-assignments", createAssignmentRouter(store as unknown as AssignmentStore, authenticate, {
    ...assignmentConfig, freshnessThresholdMs: locationConfig.freshnessThresholdMs, now,
  }));
  app.use("/api/v1/dispatch", createDispatchRouter(store as unknown as DispatchStore, authenticate, {
    ...dispatchConfig, freshnessThresholdMs: locationConfig.freshnessThresholdMs, mlModel: logisticsModel, maxPredictionMinutes: mlConfig.maxPredictionMinutes, timezoneOffsetMinutes: mlConfig.timezoneOffsetMinutes, now,
  }));
  app.use("/api/v1/delivery-lifecycle", createLifecycleRouter(store as unknown as LifecycleStore, authenticate, { now }));
  app.use("/api/v1/orders", createTrackingRouter(store as unknown as TrackingStore, authenticate, { freshnessThresholdMs: locationConfig.freshnessThresholdMs, now }));
  app.use("/api/v1/delivery-batches", createBatchRouter(store as unknown as BatchStore, authenticate, { ...batchConfig, freshnessThresholdMs: locationConfig.freshnessThresholdMs, now }));
  app.use("/api/v1/delivery-batches", createRouteRouter(store as unknown as RouteStore, authenticate, { ...routeConfig, provider: routeProvider, now }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
