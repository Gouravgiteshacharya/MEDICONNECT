import { encodeDispatchFeatures, type DispatchAcceptanceFeatures } from "./dispatch-features.js";
import { validateDispatchModelArtifact, type DispatchModelArtifact, type DispatchDataProvenance } from "./dispatch-model.types.js";

export type DispatchPredictionResult =
  | { readonly status: "predicted"; readonly acceptanceProbability: number; readonly modelVersion: string; readonly dataProvenance: DispatchDataProvenance }
  | { readonly status: "unavailable"; readonly reason: "invalid_features" | "invalid_artifact" | "invalid_prediction" };

/** Isolated continuous acceptance probability. Owns a copy; never selects riders or falls back. */
export class DispatchAcceptanceModel {
  readonly #artifact: DispatchModelArtifact | null;

  constructor(artifact: unknown) {
    try {
      const result = validateDispatchModelArtifact(structuredClone(artifact));
      this.#artifact = result.status === "valid" ? result.artifact : null;
    } catch { this.#artifact = null; }
  }

  predict(input: DispatchAcceptanceFeatures): DispatchPredictionResult {
    const artifact = this.#artifact;
    if (!artifact) return { status: "unavailable", reason: "invalid_artifact" };
    let encoded;
    try { encoded = encodeDispatchFeatures(input); }
    catch { return { status: "unavailable", reason: "invalid_features" }; }
    if (encoded.status !== "encoded") return { status: "unavailable", reason: "invalid_features" };
    let sum = 0;
    for (let i = 0; i < encoded.features.length; i++) {
      const standardized = (encoded.features[i] - artifact.preprocessing.means[i]) / artifact.preprocessing.scales[i];
      const term = artifact.coefficients[i] * standardized;
      sum += term;
      if (!Number.isFinite(standardized) || !Number.isFinite(term) || !Number.isFinite(sum)) {
        return { status: "unavailable", reason: "invalid_prediction" };
      }
    }
    const logit = artifact.intercept + sum;
    if (!Number.isFinite(logit)) return { status: "unavailable", reason: "invalid_prediction" };
    const expLogit = logit < 0 ? Math.exp(logit) : undefined;
    const acceptanceProbability = logit >= 0 ? 1 / (1 + Math.exp(-logit)) : expLogit! / (1 + expLogit!);
    if (!Number.isFinite(acceptanceProbability) || acceptanceProbability < 0 || acceptanceProbability > 1) {
      return { status: "unavailable", reason: "invalid_prediction" };
    }
    return { status: "predicted", acceptanceProbability, modelVersion: artifact.modelVersion,
      dataProvenance: artifact.trainingMetadata.dataProvenance };
  }
}
