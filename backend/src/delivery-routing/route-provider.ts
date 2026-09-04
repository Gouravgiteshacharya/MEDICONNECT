import { haversineDistanceKm, type Coordinates } from "../location/coordinates.js";

export interface RouteLeg { distanceKm: number; durationMinutes: number; }
export interface RouteProvider { estimateLeg(origin: Coordinates, destination: Coordinates): Promise<RouteLeg>; }

export class HaversineRouteProvider implements RouteProvider {
  constructor(private readonly assumedSpeedKmh: number) {}
  async estimateLeg(origin: Coordinates, destination: Coordinates): Promise<RouteLeg> {
    const distanceKm = haversineDistanceKm(origin, destination);
    return { distanceKm, durationMinutes: distanceKm / this.assumedSpeedKmh * 60 };
  }
}
