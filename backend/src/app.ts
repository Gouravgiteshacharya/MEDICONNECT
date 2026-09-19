import { createRiskHooks, type RiskHookDependencies } from "./risk/risk.hooks.js";
import { createRiskRouter } from "./risk/risk.routes.js";
import { disabledDispatchRuntime, type DispatchShadowDependencies } from "./ml/dispatch-runtime.js";
import { disabledEtaRuntime, type EtaShadowDependencies } from "./ml/eta-runtime.js";
import cors from "cors";
import { createCorsOptions } from "./config/cors.js";
import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import { prisma } from "./lib/prisma.js";
import { authenticate as platformAuthenticate } from "./middleware/authenticate.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { createApiRoutes } from "./routes/index.js";
import type { AssistantResponder } from "./modules/intelligence-experience/contracts.js";
import { createRiderRouter } from "./riders/rider.routes.js";
import type { RiderStore } from "./riders/rider.service.js";
import type { LocationStore } from "./location/location.service.js";
import { loadLocationConfig, type LocationConfig } from "./location/config.js";
import { createDeliveryQuoteRouter } from "./delivery-quotes/delivery-quote.routes.js";
import { loadDeliveryQuoteConfig, type DeliveryQuoteConfig } from "./delivery-quotes/delivery-quote.config.js";
import type { DeliveryQuoteStore } from "./delivery-quotes/delivery-quote.service.js";
import type { DistanceProvider } from "./delivery-quotes/distance-provider.js";
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
import type { RouteProvider } from "./delivery-routing/route-provider.js";
import type { RouteStore } from "./delivery-routing/route.service.js";
import { loadGoogleRoutesConfig, type GoogleRoutesConfig } from "./delivery-routing/google-routes.config.js";
import type { GoogleRoutesFetch } from "./delivery-routing/google-routes-client.js";
import { createRoutingProviders } from "./delivery-routing/routing-provider.factory.js";
import { loadMlConfig, type MlConfig } from "./ml/ml.config.js";
import type { LogisticsModel } from "./ml/logistics-model.js";

export interface AppDependencies
  extends EtaShadowDependencies,
    DispatchShadowDependencies,
    RiskHookDependencies {
  store?: RiderStore;
  authenticate?: RequestHandler;
  assistant?: AssistantResponder;
  locationConfig?: LocationConfig;
  deliveryQuoteConfig?: DeliveryQuoteConfig;
  distanceProvider?: DistanceProvider;
  assignmentConfig?: AssignmentConfig;
  dispatchConfig?: DispatchConfig;
  batchConfig?: BatchConfig;
  routeConfig?: RouteConfig;
  routeProvider?: RouteProvider;
  googleRoutesConfig?: GoogleRoutesConfig;
  googleRoutesFetch?: GoogleRoutesFetch;
  mlConfig?: MlConfig;
  mlModel?: LogisticsModel | null;
  now?: () => Date;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const store = dependencies.store ?? (prisma as unknown as RiderStore);
  const authenticate = dependencies.authenticate ?? platformAuthenticate;
  const locationConfig = dependencies.locationConfig ?? loadLocationConfig();
  const deliveryQuoteConfig = dependencies.deliveryQuoteConfig ?? loadDeliveryQuoteConfig();
  const assignmentConfig = dependencies.assignmentConfig ?? loadAssignmentConfig();
  const dispatchConfig = dependencies.dispatchConfig ?? loadDispatchConfig();
  const batchConfig = dependencies.batchConfig ?? loadBatchConfig();
  const routeConfig = dependencies.routeConfig ?? loadRouteConfig();
  const mlConfig = dependencies.mlConfig ?? loadMlConfig();
  const mlModel = dependencies.mlModel ?? null;
  const etaRuntime = dependencies.etaRuntime ?? disabledEtaRuntime;
  const onEtaShadowResult = dependencies.onEtaShadowResult;
  const dispatchShadowRuntime = dependencies.dispatchShadowRuntime ?? disabledDispatchRuntime;
  const onDispatchShadowResult = dependencies.onDispatchShadowResult;
  const riskService = dependencies.riskService;
  const readActiveRiskAssignments = dependencies.readActiveRiskAssignments;
  const onRiskHookError = dependencies.onRiskHookError;
  const now = dependencies.now ?? (() => new Date());

  const routingProviders = createRoutingProviders({
    config: dependencies.googleRoutesConfig ?? loadGoogleRoutesConfig(),
    assumedSpeedKmh: routeConfig.assumedSpeedKmh,
    fetchImplementation: dependencies.googleRoutesFetch,
  });

  const distanceProvider = dependencies.distanceProvider ?? routingProviders.distanceProvider;
  const routeProvider = dependencies.routeProvider ?? routingProviders.routeProvider;

  const app = express();
  const riskHooks = createRiskHooks({
    riskService,
    readActiveRiskAssignments,
    onRiskHookError,
  });
  const logisticsModel = mlConfig.enabled ? mlModel : null;

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors(createCorsOptions()));
  app.use(express.json({ limit: "100kb" }));

  app.use(
    "/api/v1/admin/risk-assessments",
    createRiskRouter(authenticate, riskService, now),
  );

  app.use(
    "/api/v1/orders",
    createTrackingRouter(store as unknown as TrackingStore, authenticate, {
      riskHooks,
      freshnessThresholdMs: locationConfig.freshnessThresholdMs,
      now,
    }),
  );

  app.use(
    "/api/v1",
    createApiRoutes({
      authenticate,
      assistant: dependencies.assistant,
      etaRuntime,
      onEtaShadowResult,
    }),
  );

  app.use(
    "/api/v1/riders",
    createDashboardRouter(store as unknown as DashboardStore, authenticate, {
      freshnessThresholdMs: locationConfig.freshnessThresholdMs,
      offerTimeoutMs: assignmentConfig.offerTimeoutMs,
      now,
    }),
  );

  app.use(
    "/api/v1/riders",
    createRiderRouter(store as RiderStore & LocationStore, authenticate, {
      riskHooks,
      freshnessThresholdMs: locationConfig.freshnessThresholdMs,
      sampleIntervalMs: locationConfig.sampleIntervalMs,
      now,
    }),
  );

  app.use(
    "/api/v1/delivery-quotes",
    createDeliveryQuoteRouter(store as RiderStore & DeliveryQuoteStore, authenticate, {
      config: deliveryQuoteConfig,
      distanceProvider,
      freshnessThresholdMs: locationConfig.freshnessThresholdMs,
      mlModel: logisticsModel,
      maxPredictionMinutes: mlConfig.maxPredictionMinutes,
      fallbackSpeedKmh: mlConfig.fallbackSpeedKmh,
      timezoneOffsetMinutes: mlConfig.timezoneOffsetMinutes,
      now,
    }),
  );

  app.use(
    "/api/v1/delivery-assignments",
    createAssignmentRouter(store as unknown as AssignmentStore, authenticate, {
      ...assignmentConfig,
      riskHooks,
      freshnessThresholdMs: locationConfig.freshnessThresholdMs,
      now,
    }),
  );

  app.use(
    "/api/v1/dispatch",
    createDispatchRouter(store as unknown as DispatchStore, authenticate, {
      ...dispatchConfig,
      dispatchShadowRuntime,
      onDispatchShadowResult,
      offerTimeoutMs: assignmentConfig.offerTimeoutMs,
      freshnessThresholdMs: locationConfig.freshnessThresholdMs,
      mlModel: logisticsModel,
      maxPredictionMinutes: mlConfig.maxPredictionMinutes,
      timezoneOffsetMinutes: mlConfig.timezoneOffsetMinutes,
      now,
    }),
  );

  app.use(
    "/api/v1/delivery-lifecycle",
    createLifecycleRouter(store as unknown as LifecycleStore, authenticate, {
      riskHooks,
      now,
    }),
  );

  app.use(
    "/api/v1/delivery-batches",
    createBatchRouter(store as unknown as BatchStore, authenticate, {
      ...batchConfig,
      offerTimeoutMs: assignmentConfig.offerTimeoutMs,
      freshnessThresholdMs: locationConfig.freshnessThresholdMs,
      now,
    }),
  );

  app.use(
    "/api/v1/delivery-batches",
    createRouteRouter(store as unknown as RouteStore, authenticate, {
      ...routeConfig,
      provider: routeProvider,
      now,
    }),
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export const app = createApp({});