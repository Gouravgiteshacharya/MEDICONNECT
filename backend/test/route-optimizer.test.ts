import { describe, expect, it } from "vitest";
import { optimizeStops, type OptimizerStop } from "../src/delivery-routing/route-optimizer.js";
import type { RouteProvider } from "../src/delivery-routing/route-provider.js";

const now = new Date("2026-08-31T12:00:00Z");
const provider: RouteProvider = { estimateLeg: async (origin, destination) => ({ distanceKm: Math.abs(destination.longitude - origin.longitude), durationMinutes: Math.abs(destination.longitude - origin.longitude) }) };
function stop(id: string, assignmentId: string, stopType: OptimizerStop["stopType"], longitude: number, deadlineAt: Date | null = null): OptimizerStop { return { id, assignmentId, stopType, longitude, latitude: 0, status: "PENDING", deadlineAt }; }

describe("multi-stop optimizer", () => {
  it("chooses the shortest deterministic sequence while preserving pickup-before-drop-off", async () => {
    const stops = [stop("a-p", "a", "PHARMACY_PICKUP", 1), stop("a-d", "a", "CUSTOMER_DROPOFF", 4, new Date(now.getTime() + 30 * 60_000)), stop("b-p", "b", "PHARMACY_PICKUP", 2), stop("b-d", "b", "CUSTOMER_DROPOFF", 3, new Date(now.getTime() + 30 * 60_000))];
    const result = await optimizeStops({ start: { latitude: 0, longitude: 0 }, stops, completedPickups: new Set(), now, maxLateMinutes: 0, provider });
    expect(result.stops.map((item) => item.id)).toEqual(["a-p", "b-p", "b-d", "a-d"]);
    for (const assignmentId of ["a", "b"]) expect(result.stops.findIndex((item) => item.assignmentId === assignmentId && item.stopType === "PHARMACY_PICKUP")).toBeLessThan(result.stops.findIndex((item) => item.assignmentId === assignmentId && item.stopType === "CUSTOMER_DROPOFF"));
  });
  it("allows a drop-off when its pickup is already completed", async () => {
    const result = await optimizeStops({ start: { latitude: 0, longitude: 0 }, stops: [stop("a-d", "a", "CUSTOMER_DROPOFF", 1, new Date(now.getTime() + 5 * 60_000)), stop("b-p", "b", "PHARMACY_PICKUP", 2), stop("b-d", "b", "CUSTOMER_DROPOFF", 3, new Date(now.getTime() + 10 * 60_000))], completedPickups: new Set(["a"]), now, maxLateMinutes: 0, provider });
    expect(result.stops[0].id).toBe("a-d");
  });
  it("rejects routes that cannot meet ETA constraints", async () => {
    await expect(optimizeStops({ start: { latitude: 0, longitude: 0 }, stops: [stop("p", "a", "PHARMACY_PICKUP", 5), stop("d", "a", "CUSTOMER_DROPOFF", 10, new Date(now.getTime() + 2 * 60_000))], completedPickups: new Set(), now, maxLateMinutes: 0, provider })).rejects.toMatchObject({ code: "ROUTE_ETA_UNSATISFIABLE" });
  });
  it("surfaces invalid provider output", async () => {
    await expect(optimizeStops({ start: { latitude: 0, longitude: 0 }, stops: [stop("p", "a", "PHARMACY_PICKUP", 1), stop("d", "a", "CUSTOMER_DROPOFF", 2, new Date(now.getTime() + 10 * 60_000))], completedPickups: new Set(), now, maxLateMinutes: 0, provider: { estimateLeg: async () => ({ distanceKm: Number.NaN, durationMinutes: 1 }) } })).rejects.toMatchObject({ code: "ROUTE_PROVIDER_INVALID_RESPONSE" });
  });
});
