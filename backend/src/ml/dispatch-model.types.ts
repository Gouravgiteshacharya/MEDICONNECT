import { DISPATCH_FEATURE_CONTRACT_VERSION, DISPATCH_ORDERED_FEATURES } from "./dispatch-features.js";
const DISPATCH_DATASET_SCHEMA_VERSION = "dispatch-acceptance-v1" as const;

export const DISPATCH_MODEL_ARTIFACT_VERSION = "dispatch-model-artifact-v1" as const;
export type DispatchDataProvenance = "REAL" | "SYNTHETIC" | "MIXED";
export interface DispatchModelArtifact {
  readonly artifactSchemaVersion: typeof DISPATCH_MODEL_ARTIFACT_VERSION;
  readonly modelType: "logistic_regression";
  readonly modelVersion: string;
  readonly datasetSchemaVersion: typeof DISPATCH_DATASET_SCHEMA_VERSION;
  readonly featureContractVersion: typeof DISPATCH_FEATURE_CONTRACT_VERSION;
  readonly orderedFeatures: typeof DISPATCH_ORDERED_FEATURES;
  readonly preprocessing: { readonly means: readonly number[]; readonly scales: readonly number[] };
  readonly coefficients: readonly number[];
  readonly intercept: number;
  readonly output: { readonly type: "acceptance_probability"; readonly positiveClass: "accepted_before_expiry" };
  readonly trainingMetadata: {
    readonly dataProvenance: DispatchDataProvenance;
    readonly datasetSha256: string;
    readonly gitCommit: string;
    readonly trainedAt: string;
    readonly trainingRows: number;
    readonly validationRows: number;
    readonly testRows: number;
  };
  readonly evaluation: { readonly validationLogLoss: number | null; readonly testLogLoss: number | null; readonly validationBrier: number | null; readonly testBrier: number | null };
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

export type DispatchArtifactValidation =
  | { readonly status: "valid"; readonly artifact: DispatchModelArtifact }
  | { readonly status: "unavailable"; readonly reason: "invalid_shape" | "incompatible_contract" | "invalid_parameters" | "invalid_metadata" | "invalid_evaluation" };

/** Validates portable JSON data only; no loading, inference or executable serialization. */
export function validateDispatchModelArtifact(value: unknown): DispatchArtifactValidation {
  if (!exactObject(value, ["artifactSchemaVersion", "modelType", "modelVersion", "datasetSchemaVersion", "featureContractVersion", "orderedFeatures", "preprocessing", "coefficients", "intercept", "output", "trainingMetadata", "evaluation"])) return { status: "unavailable", reason: "invalid_shape" };
  if (value.artifactSchemaVersion !== DISPATCH_MODEL_ARTIFACT_VERSION || value.modelType !== "logistic_regression"
    || value.datasetSchemaVersion !== DISPATCH_DATASET_SCHEMA_VERSION || value.featureContractVersion !== DISPATCH_FEATURE_CONTRACT_VERSION
    || !Array.isArray(value.orderedFeatures) || value.orderedFeatures.length !== 10
    || DISPATCH_ORDERED_FEATURES.some((name, index) => (value.orderedFeatures as unknown[])[index] !== name)
    || !exactObject(value.output, ["type", "positiveClass"]) || value.output.type !== "acceptance_probability" || value.output.positiveClass !== "accepted_before_expiry") return { status: "unavailable", reason: "incompatible_contract" };
  if (!exactObject(value.preprocessing, ["means", "scales"]) || !vector(value.preprocessing.means)
    || !vector(value.preprocessing.scales) || !value.preprocessing.scales.every(scale => scale > 0)
    || !vector(value.coefficients) || !finite(value.intercept)) return { status: "unavailable", reason: "invalid_parameters" };
  const metadata = value.trainingMetadata;
  if (!nonempty(value.modelVersion) || !exactObject(metadata, ["dataProvenance", "datasetSha256", "gitCommit", "trainedAt", "trainingRows", "validationRows", "testRows"])
    || !["REAL", "SYNTHETIC", "MIXED"].includes(metadata.dataProvenance as string)
    || typeof metadata.datasetSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(metadata.datasetSha256)
    || !nonempty(metadata.gitCommit) || !isoInstant(metadata.trainedAt)
    || ![metadata.trainingRows, metadata.validationRows, metadata.testRows].every(count => finite(count) && Number.isSafeInteger(count) && count >= 0)) return { status: "unavailable", reason: "invalid_metadata" };
  if (!exactObject(value.evaluation, ["validationLogLoss", "testLogLoss", "validationBrier", "testBrier"])
    || ![value.evaluation.validationLogLoss, value.evaluation.testLogLoss, value.evaluation.validationBrier, value.evaluation.testBrier].every(metric => metric === null || (finite(metric) && metric >= 0))) return { status: "unavailable", reason: "invalid_evaluation" };
  return { status: "valid", artifact: value as unknown as DispatchModelArtifact };
}
