import { haversineDistanceKm, type Coordinates } from "../location/coordinates.js";

export interface DistanceEstimate { distanceKm: number; durationMinutes?: number; }
export interface DistanceProvider {
  calculate(origin: Coordinates, destination: Coordinates): Promise<DistanceEstimate>;
}

export class HaversineDistanceProvider implements DistanceProvider {
  async calculate(origin: Coordinates, destination: Coordinates): Promise<DistanceEstimate> {
    return { distanceKm: haversineDistanceKm(origin, destination) };
  }
}
