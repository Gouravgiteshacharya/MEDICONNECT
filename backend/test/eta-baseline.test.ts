import { describe, expect, it } from "vitest";
import { predictEtaBaseline, type EtaBaselineInput } from "../src/ml/eta-baseline.js";

describe("offline ETA distance baseline", () => {
  it.each([
    [5, 20, 15],
    [1.5, 20, 5],
    [1.0001, 20, 4],
    [0, 20, 0],
    [5, 30, 10],
  ])("predicts %s km at %s km/h as %s minutes without intermediate rounding", (distanceKm, fallbackSpeedKmh, predictedMinutes) => {
    expect(predictEtaBaseline({ distanceKm, fallbackSpeedKmh })).toEqual({
      status: "predicted", predictedMinutes, source: "distance_speed_baseline",
    });
  });

  it.each([-1, NaN, Infinity, -Infinity, "5", null, undefined])("rejects invalid distance %s without coercion", distanceKm => {
    expect(predictEtaBaseline({ distanceKm, fallbackSpeedKmh: 20 } as EtaBaselineInput))
      .toEqual({ status: "unavailable", reason: "invalid_distance" });
  });

  it.each([0, -1, NaN, Infinity, -Infinity, "20", null, undefined])("rejects invalid speed %s without coercion", fallbackSpeedKmh => {
    expect(predictEtaBaseline({ distanceKm: 5, fallbackSpeedKmh } as EtaBaselineInput))
      .toEqual({ status: "unavailable", reason: "invalid_speed" });
  });

  it("reports arithmetic overflow instead of exposing Infinity", () => {
    expect(predictEtaBaseline({ distanceKm: Number.MAX_VALUE, fallbackSpeedKmh: Number.MIN_VALUE }))
      .toEqual({ status: "unavailable", reason: "prediction_overflow" });
  });

  it("is repeatable with frozen numeric input and no database or operational context", () => {
    const input = Object.freeze({ distanceKm: 5, fallbackSpeedKmh: 20 });
    expect(predictEtaBaseline(input)).toEqual(predictEtaBaseline(input));
    expect(Object.keys(predictEtaBaseline(input)).sort()).toEqual(["predictedMinutes", "source", "status"]);
  });
});
