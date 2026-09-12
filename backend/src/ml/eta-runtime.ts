import { assembleCheckoutEtaFeatures, type EtaOrderSnapshot } from "./eta-checkout.adapter.js";
import { loadEtaModelArtifact, type EtaArtifactReader } from "./eta-model.loader.js";
import { CheckoutEtaModel } from "./eta-model.js";
import type { EtaDataProvenance } from "./eta-model.types.js";

export type EtaShadowResult =
  | { readonly status: "disabled" }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "predicted"; readonly predictionPoint: "ORDER_PLACEMENT"; readonly predictedMinutes: number; readonly modelVersion: string; readonly dataProvenance: EtaDataProvenance };
export interface EtaShadowRuntime {
  readonly status: "disabled" | "unavailable" | "ready";
  predictOrderPlacement(input: EtaOrderSnapshot): EtaShadowResult;
}
export interface EtaShadowDependencies {
  readonly etaRuntime?: EtaShadowRuntime;
  readonly onEtaShadowResult?: (result: EtaShadowResult) => void | Promise<void>;
}
export const disabledEtaRuntime: EtaShadowRuntime = Object.freeze({
  status: "disabled", predictOrderPlacement: () => ({ status: "disabled" as const }),
});
function unavailable(reason: string): EtaShadowRuntime {
  return { status: "unavailable", predictOrderPlacement: () => ({ status: "unavailable", reason }) };
}

/** Optional startup configuration: invalid ETA config disables only this subsystem. */
export async function createEtaRuntime(environment: NodeJS.ProcessEnv = process.env, reader?: EtaArtifactReader): Promise<EtaShadowRuntime> {
  if (environment.ML_ETA_ENABLED !== "true") return disabledEtaRuntime;
  try {
    const mode = environment.NODE_ENV ?? "development";
    if (!["production", "development", "test"].includes(mode)) return unavailable("invalid_runtime_mode");
    const allow = environment.ML_ETA_ALLOW_SYNTHETIC ?? "false";
    if (allow !== "true" && allow !== "false") return unavailable("invalid_configuration");
    const maximum = Number(environment.ML_MAX_PREDICTION_MINUTES ?? 240);
    const offset = Number(environment.ML_TIMEZONE_OFFSET_MINUTES ?? 330);
    if (!Number.isFinite(maximum) || maximum <= 0 || !Number.isInteger(offset) || offset < -720 || offset > 840) return unavailable("invalid_configuration");
    const path = environment.ML_ETA_MODEL_PATH;
    if (!path?.trim()) return unavailable("missing_model_path");
    const checksum = environment.ML_ETA_MODEL_SHA256;
    if (mode === "production" && !checksum) return unavailable("missing_artifact_checksum");
    const loaded = await loadEtaModelArtifact(path, reader, { expectedSha256: checksum });
    if (loaded.status === "unavailable") return unavailable(loaded.reason);
    const provenance = loaded.artifact.trainingMetadata.dataProvenance;
    if (provenance === "MIXED" || (provenance === "SYNTHETIC" && (mode === "production" || allow !== "true"))) return unavailable("unsupported_provenance");
    const model = new CheckoutEtaModel(loaded.artifact, { maxPredictionMinutes: maximum });
    return {
      status: "ready",
      predictOrderPlacement(input) {
        try {
          const assembled = assembleCheckoutEtaFeatures(input, offset);
          if (assembled.status === "unavailable") return assembled;
          const prediction = model.predict(assembled.features);
          if (prediction.status === "unavailable") return prediction;
          return { ...prediction, predictionPoint: "ORDER_PLACEMENT", dataProvenance: provenance };
        } catch { return { status: "unavailable", reason: "prediction_failed" }; }
      },
    };
  } catch { return unavailable("runtime_initialization_failed"); }
}
