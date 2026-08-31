export interface DeliveryQuoteConfig {
  baseFeePaise: number;
  feePerKmPaise: number;
  expiryMs: number;
  demand?: DemandPricingConfig;
}
export interface DemandPricingConfig { moderateRatio: number; highRatio: number; peakRatio: number; moderateMultiplierBps: number; highMultiplierBps: number; peakMultiplierBps: number; }

export const DEFAULT_DELIVERY_BASE_FEE_RUPEES = "40.00";
export const DEFAULT_DELIVERY_FEE_PER_KM_RUPEES = "8.00";
export const DEFAULT_DELIVERY_QUOTE_EXPIRY_MINUTES = 15;
export const MAX_DECIMAL_10_2_PAISE = 9_999_999_999;
function positive(value: string | undefined, fallback: number, name: string) { const parsed = Number(value ?? fallback); if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`); return parsed; }
function multiplier(value: string | undefined, fallback: string, name: string) { const raw = value ?? fallback; if (!/^(?:1(?:\.\d{1,2})?|2(?:\.0{1,2})?)$/.test(raw)) throw new Error(`${name} must be between 1.00 and 2.00 with at most two decimal places`); return Math.round(Number(raw) * 10_000); }

export function rupeesToPaise(value: string, name = "currency value"): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) throw new Error(`${name} must be a non-negative rupee amount with at most two decimal places`);
  const [rupees, fraction = ""] = value.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise > MAX_DECIMAL_10_2_PAISE) throw new Error(`${name} exceeds Decimal(10,2)`);
  return paise;
}

export function paiseToRupees(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error("paise must be a non-negative safe integer");
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

export function loadDeliveryQuoteConfig(environment: NodeJS.ProcessEnv = process.env): DeliveryQuoteConfig {
  const expiryRaw = environment.DELIVERY_QUOTE_EXPIRY_MINUTES ?? String(DEFAULT_DELIVERY_QUOTE_EXPIRY_MINUTES);
  const expiryMinutes = Number(expiryRaw);
  if (!Number.isFinite(expiryMinutes) || expiryMinutes <= 0) throw new Error("DELIVERY_QUOTE_EXPIRY_MINUTES must be a positive number");
  const expiryMs = expiryMinutes * 60_000;
  if (!Number.isSafeInteger(expiryMs)) throw new Error("DELIVERY_QUOTE_EXPIRY_MINUTES is too large");
  const enabledRaw = environment.DELIVERY_DEMAND_PRICING_ENABLED ?? "true";
  if (enabledRaw !== "true" && enabledRaw !== "false") throw new Error("DELIVERY_DEMAND_PRICING_ENABLED must be true or false");
  let demand: DemandPricingConfig | undefined;
  if (enabledRaw === "true") {
    const moderateRatio = positive(environment.DELIVERY_DEMAND_MODERATE_RATIO, 1, "DELIVERY_DEMAND_MODERATE_RATIO"), highRatio = positive(environment.DELIVERY_DEMAND_HIGH_RATIO, 2, "DELIVERY_DEMAND_HIGH_RATIO"), peakRatio = positive(environment.DELIVERY_DEMAND_PEAK_RATIO, 3, "DELIVERY_DEMAND_PEAK_RATIO");
    if (!(moderateRatio < highRatio && highRatio < peakRatio)) throw new Error("Delivery demand ratios must be strictly increasing");
    const moderateMultiplierBps = multiplier(environment.DELIVERY_DEMAND_MODERATE_MULTIPLIER, "1.10", "DELIVERY_DEMAND_MODERATE_MULTIPLIER"), highMultiplierBps = multiplier(environment.DELIVERY_DEMAND_HIGH_MULTIPLIER, "1.20", "DELIVERY_DEMAND_HIGH_MULTIPLIER"), peakMultiplierBps = multiplier(environment.DELIVERY_DEMAND_PEAK_MULTIPLIER, "1.30", "DELIVERY_DEMAND_PEAK_MULTIPLIER");
    if (!(moderateMultiplierBps <= highMultiplierBps && highMultiplierBps <= peakMultiplierBps)) throw new Error("Delivery demand multipliers must be non-decreasing");
    demand = { moderateRatio, highRatio, peakRatio, moderateMultiplierBps, highMultiplierBps, peakMultiplierBps };
  }
  return {
    baseFeePaise: rupeesToPaise(environment.DELIVERY_BASE_FEE_RUPEES ?? DEFAULT_DELIVERY_BASE_FEE_RUPEES, "DELIVERY_BASE_FEE_RUPEES"),
    feePerKmPaise: rupeesToPaise(environment.DELIVERY_FEE_PER_KM_RUPEES ?? DEFAULT_DELIVERY_FEE_PER_KM_RUPEES, "DELIVERY_FEE_PER_KM_RUPEES"),
    expiryMs,
    demand,
  };
}
