import { describe, expect, it } from "vitest";
import { assembleCheckoutEtaFeatures as assemble } from "../src/ml/eta-checkout.adapter.js";
const source = { deliveryDistanceKm: 0.1234567, placedAt: new Date("2026-09-12T20:00:00Z"), items: [{ quantity: 90 }, { quantity: 1 }] };
describe("placement feature adapter", () => {
  it("preserves distance and counts lines, without encoding or operational fields", () => {
    const before = structuredClone(source);
    const expected = { status: "ready", features: { distanceKm: 0.1234567, itemCount: 2, hourOfDay: 1, dayOfWeek: 0 } };
    expect(assemble(source, 330)).toEqual(expected);
    expect(assemble(source, 330)).toEqual(expected);
    expect(source).toEqual(before);
  });
  it.each([0, 0.1, 0.499, 12.123456789])("preserves %s km", deliveryDistanceKm => {
    expect(assemble({ ...source, deliveryDistanceKm }, 0)).toMatchObject({ features: { distanceKm: deliveryDistanceKm } });
  });
  it.each([null, -1, NaN, Infinity])("rejects distance %s", deliveryDistanceKm => expect(assemble({ ...source, deliveryDistanceKm }, 0).status).toBe("unavailable"));
  it("rejects empty or invalid lines", () => {
    expect(assemble({ ...source, items: [] }, 0).status).toBe("unavailable");
    expect(assemble({ ...source, items: null as never }, 0).status).toBe("unavailable");
  });
  it.each([new Date(NaN), "2026-09-12", null])("rejects invalid placement %s", placedAt => expect(assemble({ ...source, placedAt: placedAt as Date }, 0).status).toBe("unavailable"));
  it.each([NaN, Infinity, 0.5, -721, 841])("rejects offset %s", offset => expect(assemble(source, offset).status).toBe("unavailable"));
  it.each([-720, 0, 330, 840])("matches M10 arithmetic including Date range edges at offset %s", offset => {
    for (const instant of [0, -1, -8640000000000000, 8640000000000000, source.placedAt.getTime()]) {
      const local = new Date(instant % (7 * 86_400_000) + offset * 60_000);
      expect(assemble({ ...source, placedAt: new Date(instant) }, offset)).toMatchObject({ features: { hourOfDay: local.getUTCHours(), dayOfWeek: local.getUTCDay() } });
    }
  });
  it("handles previous-day rollover", () => expect(assemble({ ...source, placedAt: new Date("2026-09-13T00:00:00Z") }, -60)).toMatchObject({ features: { hourOfDay: 23, dayOfWeek: 6 } }));
  it("isolates malformed snapshots", () => expect(assemble(null as never, 0)).toEqual({ status: "unavailable", reason: "invalid_snapshot" }));
});
