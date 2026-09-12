import { encodeCheckoutFeatures, type CheckoutEtaFeatures } from "./eta-features.js";
import { validateEtaModelArtifact, type EtaModelArtifact } from "./eta-model.types.js";

export type EtaCheckoutPredictionResult =
  | { readonly status: "predicted"; readonly predictedMinutes: number; readonly modelVersion: string }
  | { readonly status: "unavailable"; readonly reason: "invalid_features" | "invalid_artifact" | "invalid_prediction" | "invalid_prediction_limit" | "prediction_exceeds_limit" };

export interface EtaCheckoutPredictor {
  predict(input: CheckoutEtaFeatures): EtaCheckoutPredictionResult;
}

/** Isolated continuous-minute inference. Copies the artifact; never orchestrates fallback. */
export class CheckoutEtaModel implements EtaCheckoutPredictor {
  private readonly artifact: EtaModelArtifact | null;
  private readonly maximum: number | undefined;

  constructor(artifact: unknown, options: { readonly maxPredictionMinutes?: number } = {}) {
    this.maximum = options.maxPredictionMinutes;
    try {
      const copy: unknown = structuredClone(artifact);
      const result = validateEtaModelArtifact(copy);
      this.artifact = result.status === "valid" ? result.artifact : null;
    } catch { this.artifact = null; }
  }

  predict(input: CheckoutEtaFeatures): EtaCheckoutPredictionResult {
    if (!this.artifact) return { status: "unavailable", reason: "invalid_artifact" };
    if (this.maximum !== undefined && (!Number.isFinite(this.maximum) || this.maximum <= 0)) {
      return { status: "unavailable", reason: "invalid_prediction_limit" };
    }
    try {
      const encoded = encodeCheckoutFeatures(input);
      if (encoded.status !== "encoded") return { status: "unavailable", reason: "invalid_features" };
      const artifact = this.artifact;
      const sum = encoded.features.reduce((total, value, index) => {
        const standardized = (value - artifact.preprocessing.means[index]) / artifact.preprocessing.scales[index];
        return total + artifact.coefficients[index] * standardized;
      }, 0);
      const predictedMinutes = artifact.intercept + sum;
      if (!Number.isFinite(predictedMinutes) || predictedMinutes <= 0) return { status: "unavailable", reason: "invalid_prediction" };
      if (this.maximum !== undefined && predictedMinutes > this.maximum) return { status: "unavailable", reason: "prediction_exceeds_limit" };
      return { status: "predicted", predictedMinutes, modelVersion: artifact.modelVersion };
    } catch { return { status: "unavailable", reason: "invalid_features" }; }
  }
}
