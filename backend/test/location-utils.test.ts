import { describe, expect, it } from "vitest";
import { haversineDistanceKm } from "../src/location/coordinates.js";
import { classifyLocationFreshness } from "../src/location/freshness.js";

describe("haversineDistanceKm", () => {
  it("returns zero for identical points", () => expect(haversineDistanceKm({ latitude: 10, longitude: 20 }, { latitude: 10, longitude: 20 })).toBe(0));
  it("calculates straight-line distance in kilometres", () => {
    const distance = haversineDistanceKm({ latitude: 28.6139, longitude: 77.209 }, { latitude: 19.076, longitude: 72.8777 });
    expect(distance).toBeCloseTo(1148.10, 1);
  });
  it("validates both coordinates", () => expect(() => haversineDistanceKm({ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 0 })).toThrow(RangeError));
});

describe("classifyLocationFreshness", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  it("returns UNAVAILABLE without a location", () => expect(classifyLocationFreshness(null, { now, freshForMs: 60_000 })).toBe("UNAVAILABLE"));
  it("returns FRESH through the configured threshold", () => expect(classifyLocationFreshness(new Date(now.getTime() - 60_000), { now, freshForMs: 60_000 })).toBe("FRESH"));
  it("returns STALE beyond the configured threshold", () => expect(classifyLocationFreshness(new Date(now.getTime() - 60_001), { now, freshForMs: 60_000 })).toBe("STALE"));
});
