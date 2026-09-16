import {
  HaversineDistanceProvider,
  type DistanceProvider,
} from "../delivery-quotes/distance-provider.js";
import type { GoogleRoutesConfig } from "./google-routes.config.js";
import {
  GoogleRoutesClient,
  type GoogleRoutesFetch,
} from "./google-routes-client.js";
import {
  FallbackDistanceProvider,
  FallbackRouteProvider,
  GoogleRoutesDistanceProvider,
  GoogleRoutesProvider,
} from "./google-routes-providers.js";
import {
  HaversineRouteProvider,
  type RouteProvider,
} from "./route-provider.js";

export interface RoutingProviders {
  distanceProvider: DistanceProvider;
  routeProvider: RouteProvider;
  mode: "GOOGLE_ROUTES_WITH_HAVERSINE_FALLBACK" | "HAVERSINE_ONLY";
}

export function createRoutingProviders(input: {
  config: GoogleRoutesConfig;
  assumedSpeedKmh: number;
  fetchImplementation?: GoogleRoutesFetch;
}): RoutingProviders {
  const fallbackDistanceProvider = new HaversineDistanceProvider();
  const fallbackRouteProvider = new HaversineRouteProvider(
    input.assumedSpeedKmh,
  );

  if (!input.config.enabled || !input.config.apiKey) {
    return {
      distanceProvider: fallbackDistanceProvider,
      routeProvider: fallbackRouteProvider,
      mode: "HAVERSINE_ONLY",
    };
  }

  const client = new GoogleRoutesClient(
    input.config.apiKey,
    input.config.timeoutMs,
    input.fetchImplementation,
  );
  return {
    distanceProvider: new FallbackDistanceProvider(
      new GoogleRoutesDistanceProvider(client),
      fallbackDistanceProvider,
    ),
    routeProvider: new FallbackRouteProvider(
      new GoogleRoutesProvider(client),
      fallbackRouteProvider,
    ),
    mode: "GOOGLE_ROUTES_WITH_HAVERSINE_FALLBACK",
  };
}
