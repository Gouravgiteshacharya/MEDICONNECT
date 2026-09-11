import type { DemandPricingConfig } from "./delivery-quote.config.js";
export const ACTIVE_DEMAND_ORDER_STATUSES = ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] as const;
export type DemandTier = "DISABLED" | "STANDARD" | "MODERATE" | "HIGH" | "PEAK";
export interface DemandSignal { activeOrders: number; availableRiders: number; orderToRiderRatio: number | null; tier: DemandTier; multiplierBps: number; }
export function calculateDemandSignal(activeOrders: number, availableRiders: number, config?: DemandPricingConfig): DemandSignal {
  if (!Number.isInteger(activeOrders) || activeOrders < 0 || !Number.isInteger(availableRiders) || availableRiders < 0) throw new RangeError("Demand counts must be non-negative integers");
  const ratio = availableRiders === 0 ? (activeOrders === 0 ? 0 : null) : activeOrders / availableRiders;
  if (!config) return { activeOrders, availableRiders, orderToRiderRatio: ratio, tier: "DISABLED", multiplierBps: 10_000 };
  if (activeOrders === 0 || (ratio !== null && ratio <= config.moderateRatio)) return { activeOrders, availableRiders, orderToRiderRatio: ratio, tier: "STANDARD", multiplierBps: 10_000 };
  if (ratio !== null && ratio <= config.highRatio) return { activeOrders, availableRiders, orderToRiderRatio: ratio, tier: "MODERATE", multiplierBps: config.moderateMultiplierBps };
  if (ratio !== null && ratio <= config.peakRatio) return { activeOrders, availableRiders, orderToRiderRatio: ratio, tier: "HIGH", multiplierBps: config.highMultiplierBps };
  return { activeOrders, availableRiders, orderToRiderRatio: ratio, tier: "PEAK", multiplierBps: config.peakMultiplierBps };
}
export function formatMultiplier(multiplierBps: number) { return (multiplierBps / 10_000).toFixed(2); }
