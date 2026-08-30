import type { DeliveryQuoteConfig } from "./delivery-quote.config.js";
import { MAX_DECIMAL_10_2_PAISE } from "./delivery-quote.config.js";

export interface DeliveryPrice {
  baseFeePaise: number;
  distanceFeePaise: number;
  demandAdjustmentPaise: 0;
  demandMultiplier: "1.00";
  finalDeliveryFeePaise: number;
}

export function calculateDeliveryPrice(distanceKm: number, config: DeliveryQuoteConfig): DeliveryPrice {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) throw new RangeError("distanceKm must be a finite non-negative number");
  const distanceFeePaise = Math.round(distanceKm * config.feePerKmPaise);
  if (!Number.isSafeInteger(distanceFeePaise) || distanceFeePaise > MAX_DECIMAL_10_2_PAISE) throw new RangeError("calculated distance fee exceeds Decimal(10,2)");
  const finalDeliveryFeePaise = config.baseFeePaise + distanceFeePaise;
  if (!Number.isSafeInteger(finalDeliveryFeePaise) || finalDeliveryFeePaise > MAX_DECIMAL_10_2_PAISE) throw new RangeError("calculated delivery fee exceeds Decimal(10,2)");
  return {
    baseFeePaise: config.baseFeePaise,
    distanceFeePaise,
    demandAdjustmentPaise: 0,
    demandMultiplier: "1.00",
    finalDeliveryFeePaise,
  };
}
