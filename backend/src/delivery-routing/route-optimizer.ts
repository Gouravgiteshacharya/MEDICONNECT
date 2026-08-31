import { ApiError } from "../middleware/errors.js";
import type { Coordinates } from "../location/coordinates.js";
import type { RouteProvider } from "./route-provider.js";

export interface OptimizerStop extends Coordinates {
  id: string;
  assignmentId: string | null;
  stopType: "PHARMACY_PICKUP" | "CUSTOMER_DROPOFF";
  status: string;
  deadlineAt: Date | null;
}
export interface OptimizedStop extends OptimizerStop { sequence: number; estimatedArrivalAt: Date; }
export interface OptimizedRoute { stops: OptimizedStop[]; totalDistanceKm: number; totalDurationMinutes: number; }

function permutations(stops: OptimizerStop[], completedPickups: Set<string>): OptimizerStop[][] {
  const result: OptimizerStop[][] = [];
  const visit = (remaining: OptimizerStop[], chosen: OptimizerStop[], picked: Set<string>) => {
    if (!remaining.length) { result.push(chosen); return; }
    for (const stop of remaining) {
      if (stop.stopType === "CUSTOMER_DROPOFF" && stop.assignmentId && !picked.has(stop.assignmentId)) continue;
      const nextPicked = new Set(picked);
      if (stop.stopType === "PHARMACY_PICKUP" && stop.assignmentId) nextPicked.add(stop.assignmentId);
      visit(remaining.filter((item) => item.id !== stop.id), [...chosen, stop], nextPicked);
    }
  };
  visit(stops, [], completedPickups);
  return result;
}

function validLeg(value: { distanceKm: number; durationMinutes: number }) {
  return Number.isFinite(value.distanceKm) && value.distanceKm >= 0 && Number.isFinite(value.durationMinutes) && value.durationMinutes >= 0;
}

export async function optimizeStops(input: {
  start: Coordinates;
  stops: OptimizerStop[];
  completedPickups: Set<string>;
  now: Date;
  maxLateMinutes: number;
  provider: RouteProvider;
}): Promise<OptimizedRoute> {
  const locked = input.stops.filter((stop) => stop.status === "EN_ROUTE" || stop.status === "ARRIVED");
  if (locked.length > 1) throw new ApiError(409, "Multiple route stops are already in progress", "ROUTE_STATE_CONFLICT");
  const candidates = permutations(input.stops, input.completedPickups).filter((sequence) => !locked.length || sequence[0].id === locked[0].id);
  if (!candidates.length) throw new ApiError(409, "No pickup-before-delivery route is possible", "ROUTE_CONSTRAINT_UNSATISFIABLE");
  let best: OptimizedRoute | null = null;
  for (const sequence of candidates) {
    let origin = input.start, elapsed = 0, distance = 0, valid = true;
    const projected: OptimizedStop[] = [];
    for (let index = 0; index < sequence.length; index += 1) {
      let leg;
      try { leg = await input.provider.estimateLeg(origin, sequence[index]); }
      catch { throw new ApiError(502, "Route provider failed", "ROUTE_PROVIDER_FAILED"); }
      if (!validLeg(leg)) throw new ApiError(502, "Route provider returned an invalid estimate", "ROUTE_PROVIDER_INVALID_RESPONSE");
      elapsed += leg.durationMinutes; distance += leg.distanceKm;
      const estimatedArrivalAt = new Date(input.now.getTime() + elapsed * 60_000);
      const deadline = sequence[index].deadlineAt;
      if (sequence[index].stopType === "CUSTOMER_DROPOFF" && deadline && estimatedArrivalAt.getTime() > deadline.getTime() + input.maxLateMinutes * 60_000) { valid = false; break; }
      projected.push({ ...sequence[index], sequence: index + 1, estimatedArrivalAt });
      origin = sequence[index];
    }
    if (!valid) continue;
    const route = { stops: projected, totalDistanceKm: distance, totalDurationMinutes: elapsed };
    const routeKey = route.stops.map((stop) => stop.id).join(":"), bestKey = best?.stops.map((stop) => stop.id).join(":") ?? "";
    if (!best || route.totalDurationMinutes < best.totalDurationMinutes || (route.totalDurationMinutes === best.totalDurationMinutes && (route.totalDistanceKm < best.totalDistanceKm || (route.totalDistanceKm === best.totalDistanceKm && routeKey < bestKey)))) best = route;
  }
  if (!best) throw new ApiError(409, "No route can satisfy the delivery ETA constraints", "ROUTE_ETA_UNSATISFIABLE");
  return best;
}
