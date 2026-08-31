import type { DeliveryQuoteConfig } from "./delivery-quote.config.js";
import { MAX_DECIMAL_10_2_PAISE } from "./delivery-quote.config.js";

export interface DeliveryPrice {
  baseFeePaise: number;
  distanceFeePaise: number;
  demandAdjustmentPaise: number;
  demandMultiplier: string;
  finalDeliveryFeePaise: number;
}

export function calculateDeliveryPrice(distanceKm: number, config: DeliveryQuoteConfig, demandMultiplierBps = 10_000): DeliveryPrice {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) throw new RangeError("distanceKm must be a finite non-negative number");
  if (!Number.isInteger(demandMultiplierBps) || demandMultiplierBps < 10_000 || demandMultiplierBps > 20_000) throw new RangeError("demand multiplier must be between 1.00 and 2.00");
  const distanceFeePaise = Math.round(distanceKm * config.feePerKmPaise);
  if (!Number.isSafeInteger(distanceFeePaise) || distanceFeePaise > MAX_DECIMAL_10_2_PAISE) throw new RangeError("calculated distance fee exceeds Decimal(10,2)");
  const subtotalPaise = config.baseFeePaise + distanceFeePaise;
  const demandAdjustmentPaise = Math.round(subtotalPaise * (demandMultiplierBps - 10_000) / 10_000);
  const finalDeliveryFeePaise = subtotalPaise + demandAdjustmentPaise;
  if (!Number.isSafeInteger(finalDeliveryFeePaise) || finalDeliveryFeePaise > MAX_DECIMAL_10_2_PAISE) throw new RangeError("calculated delivery fee exceeds Decimal(10,2)");
  return {
    baseFeePaise: config.baseFeePaise,
    distanceFeePaise,
    demandAdjustmentPaise,
    demandMultiplier: (demandMultiplierBps / 10_000).toFixed(2),
    finalDeliveryFeePaise,
  };
}
