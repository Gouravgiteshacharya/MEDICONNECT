import { describe, expect, it } from "vitest";
import { loadDeliveryQuoteConfig, paiseToRupees, rupeesToPaise } from "../src/delivery-quotes/delivery-quote.config.js";
import { HaversineDistanceProvider } from "../src/delivery-quotes/distance-provider.js";
import { calculateDeliveryPrice } from "../src/delivery-quotes/pricing.js";
import { classifyQuoteValidity } from "../src/delivery-quotes/quote-expiry.js";
import { calculateDemandSignal } from "../src/delivery-quotes/demand-pricing.js";

describe("delivery quote pricing", () => {
  it("converts currency exactly and rounds once to the nearest paise", () => {
    expect(rupeesToPaise("40.05")).toBe(4005); expect(paiseToRupees(4005)).toBe("40.05");
    expect(calculateDeliveryPrice(1.2345, { baseFeePaise: 4000, feePerKmPaise: 805, expiryMs: 1 })).toEqual({
      baseFeePaise: 4000, distanceFeePaise: 994, demandAdjustmentPaise: 0,
      demandMultiplier: "1.00", finalDeliveryFeePaise: 4994,
    });
  });
  it("applies a demand multiplier to the base-plus-distance subtotal", () => { expect(calculateDeliveryPrice(3, { baseFeePaise: 4000, feePerKmPaise: 800, expiryMs: 1 }, 12_000)).toEqual({ baseFeePaise: 4000, distanceFeePaise: 2400, demandAdjustmentPaise: 1280, demandMultiplier: "1.20", finalDeliveryFeePaise: 7680 }); });
  it("classifies understandable bounded demand tiers", () => { const config = { moderateRatio: 1, highRatio: 2, peakRatio: 3, moderateMultiplierBps: 11_000, highMultiplierBps: 12_000, peakMultiplierBps: 13_000 }; expect(calculateDemandSignal(0, 0, config).tier).toBe("STANDARD"); expect(calculateDemandSignal(3, 2, config)).toMatchObject({ tier: "MODERATE", multiplierBps: 11_000 }); expect(calculateDemandSignal(5, 2, config)).toMatchObject({ tier: "HIGH", multiplierBps: 12_000 }); expect(calculateDemandSignal(1, 0, config)).toMatchObject({ tier: "PEAK", multiplierBps: 13_000, orderToRiderRatio: null }); });
  it.each([
    { DELIVERY_BASE_FEE_RUPEES: "1.234" },
    { DELIVERY_BASE_FEE_RUPEES: "100000000.00" },
    { DELIVERY_FEE_PER_KM_RUPEES: "-1" },
    { DELIVERY_QUOTE_EXPIRY_MINUTES: "0" },
    { DELIVERY_QUOTE_EXPIRY_MINUTES: "not-a-number" },
    { DELIVERY_DEMAND_PRICING_ENABLED: "yes" },
    { DELIVERY_DEMAND_MODERATE_RATIO: "3", DELIVERY_DEMAND_HIGH_RATIO: "2" },
    { DELIVERY_DEMAND_PEAK_MULTIPLIER: "2.10" },
  ])("rejects invalid pricing configuration", (environment) => expect(() => loadDeliveryQuoteConfig(environment)).toThrow());
});

describe("HaversineDistanceProvider", () => {
  it("returns straight-line distance without inventing duration", async () => {
    const result = await new HaversineDistanceProvider().calculate(
      { latitude: 28.6139, longitude: 77.209 }, { latitude: 19.076, longitude: 72.8777 },
    );
    expect(result.distanceKm).toBeCloseTo(1148.10, 1); expect(result.durationMinutes).toBeUndefined();
  });
});

describe("quote expiry", () => {
  const expiry = new Date("2026-08-30T12:15:00Z");
  it("is valid before expiry", () => expect(classifyQuoteValidity(expiry, new Date(expiry.getTime() - 1))).toBe("VALID"));
  it("is expired at the exact boundary", () => expect(classifyQuoteValidity(expiry, expiry)).toBe("EXPIRED"));
  it("is expired after expiry", () => expect(classifyQuoteValidity(expiry, new Date(expiry.getTime() + 1))).toBe("EXPIRED"));
});
