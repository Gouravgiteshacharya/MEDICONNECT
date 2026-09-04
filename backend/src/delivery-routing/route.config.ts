export interface RouteConfig {
  assumedSpeedKmh: number;
  maxLateMinutes: number;
  maxStops: number;
}

export function loadRouteConfig(environment: NodeJS.ProcessEnv = process.env): RouteConfig {
  const assumedSpeedKmh = Number(environment.ROUTE_ASSUMED_SPEED_KMH ?? 20);
  const maxLateMinutes = Number(environment.ROUTE_MAX_LATE_MINUTES ?? 5);
  const maxStops = Number(environment.ROUTE_MAX_STOPS ?? 6);
  if (!Number.isFinite(assumedSpeedKmh) || assumedSpeedKmh <= 0) throw new Error("ROUTE_ASSUMED_SPEED_KMH must be positive");
  if (!Number.isFinite(maxLateMinutes) || maxLateMinutes < 0) throw new Error("ROUTE_MAX_LATE_MINUTES must be non-negative");
  if (!Number.isInteger(maxStops) || maxStops < 2 || maxStops > 8) throw new Error("ROUTE_MAX_STOPS must be an integer from 2 to 8");
  return { assumedSpeedKmh, maxLateMinutes, maxStops };
}
