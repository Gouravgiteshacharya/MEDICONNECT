import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISPATCH_ORDERED_FEATURES } from "../src/ml/dispatch-features.js";
import { validateDispatchModelArtifact, type DispatchModelArtifact } from "../src/ml/dispatch-model.types.js";

// Contract fixture only: these arbitrary numbers are not a fitted or deployable model.
function artifact(): DispatchModelArtifact {
  return {
    artifactSchemaVersion: "dispatch-model-artifact-v1", modelType: "logistic_regression", modelVersion: "contract-test-only",
    datasetSchemaVersion: "dispatch-acceptance-v1", featureContractVersion: "dispatch-acceptance-features-v1",
    orderedFeatures: DISPATCH_ORDERED_FEATURES, preprocessing: { means: Array(10).fill(0), scales: Array(10).fill(1) },
    coefficients: Array(10).fill(0), intercept: 1, output: { type: "acceptance_probability", positiveClass: "accepted_before_expiry" },
    trainingMetadata: { dataProvenance: "SYNTHETIC", datasetSha256: "a".repeat(64), gitCommit: "test",
      trainedAt: "2026-01-01T00:00:00.000Z", trainingRows: 0, validationRows: 0, testRows: 0 },
    evaluation: { validationLogLoss: null, testLogLoss: null, validationBrier: null, testBrier: null },
  };
}
describe("portable DISPATCH artifact validation", () => {
  it("accepts the Python prediction-parity artifact contract", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../ml/dispatch/fixtures/prediction-parity.json", import.meta.url), "utf8"));
    expect(validateDispatchModelArtifact(fixture.artifact).status).toBe("valid");
  });
  it.each(["validationLogLoss", "testLogLoss", "validationBrier", "testBrier"])("validates finite/null evaluation metric %s", key => {
    const value = artifact();
    for (const metric of [null, 0, 0.25]) expect(validateDispatchModelArtifact({ ...value, evaluation: { ...value.evaluation, [key]: metric } }).status).toBe("valid");
    for (const metric of [-1, Infinity, NaN, "0"]) expect(validateDispatchModelArtifact({ ...value, evaluation: { ...value.evaluation, [key]: metric } }).status).toBe("unavailable");
  });
  it("accepts a complete contract fixture without raw rows and is deterministic", () => {
    const value = artifact();
    expect(validateDispatchModelArtifact(value)).toEqual({ status: "valid", artifact: value });
    expect(validateDispatchModelArtifact(value)).toEqual(validateDispatchModelArtifact(value));
    expect(JSON.stringify(value)).not.toContain("orderId");
  });
  it.each([
    { artifactSchemaVersion: "v0" }, { modelType: "tree" }, { datasetSchemaVersion: "v0" },
    { featureContractVersion: "v0" }, { orderedFeatures: [...DISPATCH_ORDERED_FEATURES].reverse() },
    { coefficients: [1] }, { coefficients: Array(10).fill(NaN) }, { coefficients: Array(10).fill(Infinity) },
    { coefficients: Array(10) }, { intercept: Infinity }, { modelVersion: " " },
    { output: { unit: "seconds" } }, { rawRows: [] },
    { preprocessing: { means: [0], scales: Array(10).fill(1) } },
    { preprocessing: { means: Array(10).fill(Infinity), scales: Array(10).fill(1) } },
    { preprocessing: { means: Array(10).fill(0), scales: [1] } },
    { preprocessing: { means: Array(10).fill(0), scales: Array(10).fill(0) } },
    { preprocessing: { means: Array(10).fill(0), scales: Array(10).fill(-1) } },
    { preprocessing: { means: Array(10).fill(0), scales: Array(10).fill(Infinity) } },
    { evaluation: { validationLogLoss: -1, testLogLoss: null } }, { evaluation: { validationLogLoss: null, testLogLoss: NaN } },
  ])("rejects incompatible/invalid artifact %j", override => {
    expect(validateDispatchModelArtifact({ ...artifact(), ...override }).status).toBe("unavailable");
  });
  it.each([
    { dataProvenance: "UNKNOWN" }, { datasetSha256: "" }, { datasetSha256: "not-a-checksum" },
    { gitCommit: " " }, { trainedAt: "yesterday" }, { trainedAt: "2026-02-30T00:00:00Z" },
    { trainedAt: "2026-01-01" }, { trainingRows: -1 }, { validationRows: 0.5 }, { testRows: Infinity },
    { trainingRows: "1" }, { testRows: Number.MAX_SAFE_INTEGER + 1 }, { orderId: "private" },
  ])("rejects invalid metadata %j", override => {
    const value = artifact();
    expect(validateDispatchModelArtifact({ ...value, trainingMetadata: { ...value.trainingMetadata, ...override } }).status).toBe("unavailable");
  });
  it.each(["REAL", "SYNTHETIC", "MIXED"])("accepts allowed provenance %s", dataProvenance => {
    const value = artifact();
    expect(validateDispatchModelArtifact({ ...value, trainingMetadata: { ...value.trainingMetadata, dataProvenance } }).status).toBe("valid");
  });
  it.each([null, [], {}, "json"])("rejects invalid shape %j", value => expect(validateDispatchModelArtifact(value).status).toBe("unavailable"));
});
