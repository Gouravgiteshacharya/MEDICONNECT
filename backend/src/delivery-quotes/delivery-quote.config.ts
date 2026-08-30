export interface DeliveryQuoteConfig {
  baseFeePaise: number;
  feePerKmPaise: number;
  expiryMs: number;
}

export const DEFAULT_DELIVERY_BASE_FEE_RUPEES = "40.00";
export const DEFAULT_DELIVERY_FEE_PER_KM_RUPEES = "8.00";
export const DEFAULT_DELIVERY_QUOTE_EXPIRY_MINUTES = 15;
export const MAX_DECIMAL_10_2_PAISE = 9_999_999_999;

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
  return {
    baseFeePaise: rupeesToPaise(environment.DELIVERY_BASE_FEE_RUPEES ?? DEFAULT_DELIVERY_BASE_FEE_RUPEES, "DELIVERY_BASE_FEE_RUPEES"),
    feePerKmPaise: rupeesToPaise(environment.DELIVERY_FEE_PER_KM_RUPEES ?? DEFAULT_DELIVERY_FEE_PER_KM_RUPEES, "DELIVERY_FEE_PER_KM_RUPEES"),
    expiryMs,
  };
}
