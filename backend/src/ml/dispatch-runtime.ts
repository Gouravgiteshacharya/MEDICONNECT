import { loadDispatchRuntimeConfig } from "./dispatch-runtime.config.js";
import { loadDispatchModelArtifact, type DispatchArtifactReader, type DispatchArtifactLoadResult } from "./dispatch-model.loader.js";
import { DispatchAcceptanceModel } from "./dispatch-model.js";
import type { DispatchDataProvenance } from "./dispatch-model.types.js";

export interface DispatchCandidateShadowInput {
  readonly candidateKey: string;
  readonly riderDistanceKm: number;
  readonly activeWorkload: number;
  readonly attemptedAt: Date;
}
export type DispatchShadowReason = Extract<DispatchArtifactLoadResult, { status: "unavailable" }>["reason"]
  | "invalid_configuration" | "missing_model_path" | "missing_artifact_checksum" | "unsupported_provenance"
  | "runtime_initialization_failed" | "prediction_failed" | "no_scored_candidates";
export interface DispatchCandidateShadowScore {
  readonly candidateKey: string;
  readonly deterministicRank: number;
  readonly acceptanceProbability: number | null;
  readonly shadowRank: number | null;
}
export type DispatchShadowScoringResult =
  | { readonly status: "disabled" }
  | { readonly status: "unavailable"; readonly reason: DispatchShadowReason }
  | { readonly status: "predicted"; readonly modelVersion: string; readonly dataProvenance: DispatchDataProvenance;
      readonly candidates: readonly DispatchCandidateShadowScore[] };
type Scorer = (inputs: readonly DispatchCandidateShadowInput[]) => DispatchShadowScoringResult;
export type DispatchShadowRuntime =
  | { readonly status: "disabled"; readonly scoreCandidates: Scorer }
  | { readonly status: "unavailable"; readonly scoreCandidates: Scorer }
  | { readonly status: "ready"; readonly scoreCandidates: Scorer };
export interface DispatchShadowObservation {
  readonly status: "predicted" | "unavailable" | "disabled";
  readonly candidateCount: number;
  readonly scoredCandidateCount: number;
  readonly selectionPolicy: "DETERMINISTIC_FALLBACK" | "ML_ASSISTED";
  readonly selectedDeterministicRank: number;
  readonly selectedShadowRank: number | null;
  readonly modelVersion?: string;
  readonly dataProvenance?: DispatchDataProvenance;
  readonly deterministicTopRankAgreesWithShadow?: boolean;
  readonly reason?: DispatchShadowReason;
}
export interface DispatchShadowDependencies {
  readonly dispatchShadowRuntime?: DispatchShadowRuntime;
  readonly onDispatchShadowResult?: (result: DispatchShadowObservation) => void | Promise<void>;
}
export const disabledDispatchRuntime: DispatchShadowRuntime = Object.freeze({
  status: "disabled", scoreCandidates: () => ({ status: "disabled" as const }),
});
function unavailable(reason: DispatchShadowReason): DispatchShadowRuntime {
  return { status: "unavailable", scoreCandidates: () => ({ status: "unavailable", reason }) };
}

/** Startup-only construction. No mutation, legacy model, DB, logging or request-time I/O. */
export async function createDispatchRuntime(environment: NodeJS.ProcessEnv = process.env, reader?: DispatchArtifactReader): Promise<DispatchShadowRuntime> {
  try {
    const config = loadDispatchRuntimeConfig(environment);
    if (config.status === "disabled") return disabledDispatchRuntime;
    if (config.status === "unavailable") return unavailable(config.reason);
    const loaded = await loadDispatchModelArtifact(config.modelPath, reader, { expectedSha256: config.expectedSha256 });
    if (loaded.status === "unavailable") return unavailable(loaded.reason);
    const provenance = loaded.artifact.trainingMetadata.dataProvenance;
    if (provenance === "MIXED" || (provenance === "SYNTHETIC" && (config.production || !config.allowSynthetic))) return unavailable("unsupported_provenance");
    const model = new DispatchAcceptanceModel(loaded.artifact);
    return {
      status: "ready",
      scoreCandidates(inputs) {
        try {
          const candidates = inputs.map((input, index) => {
            let probability: number | null = null;
            if (typeof input.candidateKey === "string" && input.candidateKey.length > 0 && input.attemptedAt instanceof Date && Number.isFinite(input.attemptedAt.getTime())) {
              const local = new Date(input.attemptedAt.getTime() + config.timezoneOffsetMinutes * 60_000);
              const prediction = model.predict({ riderDistanceKm: input.riderDistanceKm, activeWorkload: input.activeWorkload,
                hourOfDay: local.getUTCHours(), dayOfWeek: local.getUTCDay() });
              if (prediction.status === "predicted") probability = prediction.acceptanceProbability;
            }
            return { candidateKey: input.candidateKey, deterministicRank: index + 1,
              acceptanceProbability: probability, shadowRank: null as number | null };
          });
          // Caller supplies deterministic shortlist order. This sort operates on a new array only.
          const scored = candidates.filter(c => c.acceptanceProbability !== null).sort((a, b) =>
            b.acceptanceProbability! - a.acceptanceProbability! || a.deterministicRank - b.deterministicRank || a.candidateKey.localeCompare(b.candidateKey));
          scored.forEach((c, index) => { c.shadowRank = index + 1; });
          if (!scored.length) return { status: "unavailable", reason: "no_scored_candidates" };
          return { status: "predicted", candidates, modelVersion: loaded.artifact.modelVersion, dataProvenance: provenance };
        } catch { return { status: "unavailable", reason: "prediction_failed" }; }
      },
    };
  } catch { return unavailable("runtime_initialization_failed"); }
}

/** Explicit safe projection: no keys, identities, features or individual probabilities escape. */
export function observeDispatchShadow(runtime: DispatchShadowRuntime, inputs: readonly DispatchCandidateShadowInput[],
  selectedDeterministicRank: number, selectionPolicy: DispatchShadowObservation["selectionPolicy"]): DispatchShadowObservation {
  const base = { candidateCount: inputs.length, scoredCandidateCount: 0, selectedDeterministicRank, selectedShadowRank: null, selectionPolicy };
  try {
    // Protect the authoritative snapshot even from an injected scorer mutating its arguments.
    const result = runtime.scoreCandidates(structuredClone(inputs));
    if (result.status === "disabled") return { ...base, status: "disabled" };
    if (result.status === "unavailable") return { ...base, status: "unavailable", reason: result.reason };
    if (result.candidates.length !== inputs.length || result.candidates.some((c, i) =>
      c.candidateKey !== inputs[i].candidateKey || c.deterministicRank !== i + 1
      || (c.acceptanceProbability !== null && (!Number.isFinite(c.acceptanceProbability) || c.acceptanceProbability < 0 || c.acceptanceProbability > 1)))) {
      return { ...base, status: "unavailable", reason: "prediction_failed" };
    }
    return { ...base, status: "predicted", scoredCandidateCount: result.candidates.filter(c => c.acceptanceProbability !== null).length,
      selectedShadowRank: result.candidates[selectedDeterministicRank - 1]?.shadowRank ?? null,
      modelVersion: result.modelVersion, dataProvenance: result.dataProvenance,
      deterministicTopRankAgreesWithShadow: result.candidates[0]?.shadowRank === 1 };
  } catch { return { ...base, status: "unavailable", reason: "prediction_failed" }; }
}
