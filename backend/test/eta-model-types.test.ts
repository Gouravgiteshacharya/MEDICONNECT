import { describe, expect, it } from "vitest";
import { ETA_ORDERED_FEATURES } from "../src/ml/eta-features.js";
import { validateEtaModelArtifact, type EtaModelArtifact } from "../src/ml/eta-model.types.js";

// Contract fixture only: these arbitrary numbers are not a fitted or deployable model.
function artifact(): EtaModelArtifact {
  return {
    artifactSchemaVersion: "eta-model-artifact-v1", modelType: "ridge", modelVersion: "contract-test-only",
    datasetSchemaVersion: "eta-checkout-v1", featureContractVersion: "eta-checkout-features-v1",
    orderedFeatures: ETA_ORDERED_FEATURES, preprocessing: { means: Array(10).fill(0), scales: Array(10).fill(1) },
    coefficients: Array(10).fill(0), intercept: 1, output: { unit: "minutes" },
    trainingMetadata: { dataProvenance: "SYNTHETIC", datasetSha256: "a".repeat(64), gitCommit: "test",
      trainedAt: "2026-01-01T00:00:00.000Z", trainingRows: 0, validationRows: 0, testRows: 0 },
    evaluation: { validationMae: null, testMae: null },
  };
}
describe("portable ETA artifact validation", () => {
  it("accepts a complete contract fixture without raw rows and is deterministic", () => {
    const value = artifact();
    expect(validateEtaModelArtifact(value)).toEqual({ status: "valid", artifact: value });
    expect(validateEtaModelArtifact(value)).toEqual(validateEtaModelArtifact(value));
    expect(JSON.stringify(value)).not.toContain("orderId");
  });
  it.each([
    { artifactSchemaVersion: "v0" }, { modelType: "tree" }, { datasetSchemaVersion: "v0" },
    { featureContractVersion: "v0" }, { orderedFeatures: [...ETA_ORDERED_FEATURES].reverse() },
    { coefficients: [1] }, { coefficients: Array(10).fill(NaN) }, { coefficients: Array(10).fill(Infinity) },
    { coefficients: Array(10) }, { intercept: Infinity }, { modelVersion: " " },
    { output: { unit: "seconds" } }, { rawRows: [] },
    { preprocessing: { means: [0], scales: Array(10).fill(1) } },
    { preprocessing: { means: Array(10).fill(Infinity), scales: Array(10).fill(1) } },
    { preprocessing: { means: Array(10).fill(0), scales: [1] } },
    { preprocessing: { means: Array(10).fill(0), scales: Array(10).fill(0) } },
    { preprocessing: { means: Array(10).fill(0), scales: Array(10).fill(-1) } },
    { preprocessing: { means: Array(10).fill(0), scales: Array(10).fill(Infinity) } },
    { evaluation: { validationMae: -1, testMae: null } }, { evaluation: { validationMae: null, testMae: NaN } },
  ])("rejects incompatible/invalid artifact %j", override => {
    expect(validateEtaModelArtifact({ ...artifact(), ...override }).status).toBe("unavailable");
  });
  it.each([
    { dataProvenance: "UNKNOWN" }, { datasetSha256: "" }, { datasetSha256: "not-a-checksum" },
    { gitCommit: " " }, { trainedAt: "yesterday" }, { trainedAt: "2026-02-30T00:00:00Z" },
    { trainedAt: "2026-01-01" }, { trainingRows: -1 }, { validationRows: 0.5 }, { testRows: Infinity },
    { trainingRows: "1" }, { testRows: Number.MAX_SAFE_INTEGER + 1 }, { orderId: "private" },
  ])("rejects invalid metadata %j", override => {
    const value = artifact();
    expect(validateEtaModelArtifact({ ...value, trainingMetadata: { ...value.trainingMetadata, ...override } }).status).toBe("unavailable");
  });
  it.each(["REAL", "SYNTHETIC", "MIXED"])("accepts allowed provenance %s", dataProvenance => {
    const value = artifact();
    expect(validateEtaModelArtifact({ ...value, trainingMetadata: { ...value.trainingMetadata, dataProvenance } }).status).toBe("valid");
  });
  it.each([null, [], {}, "json"])("rejects invalid shape %j", value => expect(validateEtaModelArtifact(value).status).toBe("unavailable"));
});
