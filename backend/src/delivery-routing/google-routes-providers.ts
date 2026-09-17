import type {
  DistanceEstimate,
  DistanceProvider,
} from "../delivery-quotes/distance-provider.js";
import {
  validateCoordinates,
  type Coordinates,
} from "../location/coordinates.js";
import type { GoogleRoutesClient } from "./google-routes-client.js";
import type { RouteLeg, RouteProvider } from "./route-provider.js";

export class GoogleRoutesDistanceProvider implements DistanceProvider {
  constructor(private readonly client: GoogleRoutesClient) {}

  calculate(
    origin: Coordinates,
    destination: Coordinates,
  ): Promise<DistanceEstimate> {
    return this.client.estimate(origin, destination);
  }
}

export class GoogleRoutesProvider implements RouteProvider {
  constructor(private readonly client: GoogleRoutesClient) {}

  estimateLeg(
    origin: Coordinates,
    destination: Coordinates,
  ): Promise<RouteLeg> {
    return this.client.estimate(origin, destination);
  }
}

export class FallbackDistanceProvider implements DistanceProvider {
  constructor(
    private readonly primary: DistanceProvider,
    private readonly fallback: DistanceProvider,
  ) {}

  async calculate(
    origin: Coordinates,
    destination: Coordinates,
  ): Promise<DistanceEstimate> {
    validateCoordinates(origin);
    validateCoordinates(destination);
    try {
      return await this.primary.calculate(origin, destination);
    } catch {
      return this.fallback.calculate(origin, destination);
    }
  }
}

export class FallbackRouteProvider implements RouteProvider {
  constructor(
    private readonly primary: RouteProvider,
    private readonly fallback: RouteProvider,
  ) {}

  async estimateLeg(
    origin: Coordinates,
    destination: Coordinates,
  ): Promise<RouteLeg> {
    validateCoordinates(origin);
    validateCoordinates(destination);
    try {
      return await this.primary.estimateLeg(origin, destination);
    } catch {
      return this.fallback.estimateLeg(origin, destination);
    }
  }
}
