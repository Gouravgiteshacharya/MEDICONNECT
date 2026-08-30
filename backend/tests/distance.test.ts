import { describe, expect, it } from "vitest";

import {
  calculateGeographicBoundingBox,
  haversineDistanceKm,
  normalizeLongitude,
  roundDistanceKm,
} from "../src/utils/distance.js";

describe("distance utilities", () => {
  it("returns zero distance for identical coordinates", () => {
    expect(haversineDistanceKm(12.9716, 77.5946, 12.9716, 77.5946)).toBe(0);
  });

  it("matches a known Haversine fixture", () => {
    const distance = haversineDistanceKm(36.12, -86.67, 33.94, -118.4);
    expect(distance).toBeCloseTo(2886.448, 0);
  });

  it("is symmetric", () => {
    const forward = haversineDistanceKm(12.9716, 77.5946, -33.8688, 151.2093);
    const reverse = haversineDistanceKm(-33.8688, 151.2093, 12.9716, 77.5946);
    expect(forward).toBeCloseTo(reverse, 10);
  });

  it("rounds output to three decimal places", () => {
    expect(roundDistanceKm(1.73249)).toBe(1.732);
    expect(roundDistanceKm(1.7325)).toBe(1.733);
  });

  it("handles southern hemisphere coordinates", () => {
    expect(haversineDistanceKm(-33.8688, 151.2093, -37.8136, 144.9631)).toBeGreaterThan(700);
  });

  it("omits unsafe longitude filtering near a pole", () => {
    const box = calculateGeographicBoundingBox(89.9, 20, 50);
    expect(box.maxLatitude).toBe(90);
    expect(box.longitudeRanges).toBeNull();
  });

  it("creates wrapped longitude ranges across the antimeridian", () => {
    const box = calculateGeographicBoundingBox(0, 179.9, 50);
    expect(box.longitudeRanges).toHaveLength(2);
    expect(haversineDistanceKm(0, 179.9, 0, -179.9)).toBeLessThan(50);
  });

  it.each([
    [181, -179],
    [-181, 179],
    [540, -180],
    [-540, -180],
  ])("normalizes longitude %s to %s", (input, expected) => {
    expect(normalizeLongitude(input)).toBe(expected);
  });
});
