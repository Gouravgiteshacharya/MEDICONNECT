import { ETA_FEATURE_CONTRACT_VERSION, ETA_ORDERED_FEATURES } from "./eta-features.js";
import { ETA_DATASET_SCHEMA_VERSION } from "./dataset/eta-dataset.types.js";

export const ETA_MODEL_ARTIFACT_VERSION = "eta-model-artifact-v1" as const;
export type EtaDataProvenance = "REAL" | "SYNTHETIC" | "MIXED";
export interface EtaModelArtifact {
  readonly artifactSchemaVersion: typeof ETA_MODEL_ARTIFACT_VERSION;
  readonly modelType: "ridge";
  readonly modelVersion: string;
  readonly datasetSchemaVersion: typeof ETA_DATASET_SCHEMA_VERSION;
  readonly featureContractVersion: typeof ETA_FEATURE_CONTRACT_VERSION;
  readonly orderedFeatures: typeof ETA_ORDERED_FEATURES;
  readonly preprocessing: { readonly means: readonly number[]; readonly scales: readonly number[] };
  readonly coefficients: readonly number[];
  readonly intercept: number;
  readonly output: { readonly unit: "minutes" };
  readonly trainingMetadata: {
    readonly dataProvenance: EtaDataProvenance;
    readonly datasetSha256: string;
    readonly gitCommit: string;
    readonly trainedAt: string;
    readonly trainingRows: number;
    readonly validationRows: number;
    readonly testRows: number;
  };
  readonly evaluation: { readonly validationMae: number | null; readonly testMae: number | null };
}

type ObjectValue = Record<string, unknown>;
function exactObject(value: unknown, keys: readonly string[]): value is ObjectValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const vector = (value: unknown): value is number[] => Array.isArray(value) && value.length === 10
  && Array.from(value).every(finite);
function isoInstant(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"));
}

export type EtaArtifactValidation =
  | { readonly status: "valid"; readonly artifact: EtaModelArtifact }
  | { readonly status: "unavailable"; readonly reason: "invalid_shape" | "incompatible_contract" | "invalid_parameters" | "invalid_metadata" | "invalid_evaluation" };

/** Validates portable JSON data only; no loading, inference or executable serialization. */
export function validateEtaModelArtifact(value: unknown): EtaArtifactValidation {
  if (!exactObject(value, ["artifactSchemaVersion", "modelType", "modelVersion", "datasetSchemaVersion", "featureContractVersion", "orderedFeatures", "preprocessing", "coefficients", "intercept", "output", "trainingMetadata", "evaluation"])) return { status: "unavailable", reason: "invalid_shape" };
  if (value.artifactSchemaVersion !== ETA_MODEL_ARTIFACT_VERSION || value.modelType !== "ridge"
    || value.datasetSchemaVersion !== ETA_DATASET_SCHEMA_VERSION || value.featureContractVersion !== ETA_FEATURE_CONTRACT_VERSION
    || !Array.isArray(value.orderedFeatures) || value.orderedFeatures.length !== 10
    || ETA_ORDERED_FEATURES.some((name, index) => (value.orderedFeatures as unknown[])[index] !== name)
    || !exactObject(value.output, ["unit"]) || value.output.unit !== "minutes") return { status: "unavailable", reason: "incompatible_contract" };
  if (!exactObject(value.preprocessing, ["means", "scales"]) || !vector(value.preprocessing.means)
    || !vector(value.preprocessing.scales) || !value.preprocessing.scales.every(scale => scale > 0)
    || !vector(value.coefficients) || !finite(value.intercept)) return { status: "unavailable", reason: "invalid_parameters" };
  const metadata = value.trainingMetadata;
  if (!nonempty(value.modelVersion) || !exactObject(metadata, ["dataProvenance", "datasetSha256", "gitCommit", "trainedAt", "trainingRows", "validationRows", "testRows"])
    || !["REAL", "SYNTHETIC", "MIXED"].includes(metadata.dataProvenance as string)
    || typeof metadata.datasetSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(metadata.datasetSha256)
    || !nonempty(metadata.gitCommit) || !isoInstant(metadata.trainedAt)
    || ![metadata.trainingRows, metadata.validationRows, metadata.testRows].every(count => finite(count) && Number.isSafeInteger(count) && count >= 0)) return { status: "unavailable", reason: "invalid_metadata" };
  if (!exactObject(value.evaluation, ["validationMae", "testMae"])
    || ![value.evaluation.validationMae, value.evaluation.testMae].every(metric => metric === null || (finite(metric) && metric >= 0))) return { status: "unavailable", reason: "invalid_evaluation" };
  return { status: "valid", artifact: value as unknown as EtaModelArtifact };
}
