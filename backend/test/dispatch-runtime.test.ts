import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDispatchRuntime, disabledDispatchRuntime, observeDispatchShadow } from "../src/ml/dispatch-runtime.js";
import { DispatchAcceptanceModel } from "../src/ml/dispatch-model.js";

// REAL is a policy-test declaration only; this hand-authored fixture was never trained on real data.
const real = JSON.parse(readFileSync(new URL("./fixtures/dispatch-model-artifact.real-policy.test.json", import.meta.url), "utf8"));
const synthetic = JSON.parse(readFileSync(new URL("./fixtures/dispatch-model-artifact.synthetic.test.json", import.meta.url), "utf8"));
const config = { NODE_ENV: "test", ML_DISPATCH_SHADOW_ENABLED: "true", ML_DISPATCH_MODEL_PATH: "explicit.json", ML_DISPATCH_TIMEZONE_OFFSET_MINUTES: "330" };
const input = { candidateKey: "opaque-local", riderDistanceKm: 1.25, activeWorkload: 0, attemptedAt: new Date("2026-09-12T18:30:00Z") };
const checksum = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const fakeReader = (artifact = real) => ({ readFile: vi.fn().mockResolvedValue(JSON.stringify(artifact)) });
afterEach(() => vi.restoreAllMocks());

describe("dispatch shadow runtime configuration and policy", () => {
  it.each([undefined, "false", "TRUE", "1"])("disabled unless explicitly true: %s", async enabled => {
    const reader = fakeReader();
    const runtime = await createDispatchRuntime({ ML_DISPATCH_SHADOW_ENABLED: enabled }, reader);
    expect(runtime.status).toBe("disabled");
    expect(runtime.scoreCandidates([input])).toEqual({ status: "disabled" });
    expect(reader.readFile).not.toHaveBeenCalled();
  });
  it("loads once and scores repeatedly without I/O", async () => {
    const reader = fakeReader(); const runtime = await createDispatchRuntime(config, reader);
    expect(runtime.status).toBe("ready");
    for (let i = 0; i < 3; i++) expect(runtime.scoreCandidates([input]).status).toBe("predicted");
    expect(reader.readFile).toHaveBeenCalledExactlyOnceWith("explicit.json", "utf8");
  });
  it.each([
    { ML_DISPATCH_TIMEZONE_OFFSET_MINUTES: undefined }, { ML_DISPATCH_TIMEZONE_OFFSET_MINUTES: "" },
    { ML_DISPATCH_TIMEZONE_OFFSET_MINUTES: "1.5" }, { ML_DISPATCH_TIMEZONE_OFFSET_MINUTES: "841" },
    { ML_DISPATCH_TIMEZONE_OFFSET_MINUTES: "-841" }, { NODE_ENV: "staging" }, { ML_DISPATCH_ALLOW_SYNTHETIC: "1" },
  ])("rejects invalid config without startup failure %j", async override => {
    const reader = fakeReader(); const runtime = await createDispatchRuntime({ ...config, ...override }, reader);
    expect(runtime.scoreCandidates([input])).toEqual({ status: "unavailable", reason: "invalid_configuration" });
    expect(reader.readFile).not.toHaveBeenCalled();
  });
  it("requires explicit path only when enabled", async () => {
    const runtime = await createDispatchRuntime({ ...config, ML_DISPATCH_MODEL_PATH: undefined }, fakeReader());
    expect(runtime.scoreCandidates([input])).toEqual({ status: "unavailable", reason: "missing_model_path" });
  });
  it.each([["ENOENT", "file_not_found"], ["EACCES", "read_failed"]])("isolates %s", async (code, reason) => {
    const runtime = await createDispatchRuntime(config, { readFile: vi.fn().mockRejectedValue(Object.assign(new Error("private"), { code })) });
    expect(runtime.scoreCandidates([input])).toEqual({ status: "unavailable", reason });
  });
  it.each([["{", "invalid_json"], ["{}", "invalid_artifact"]])("isolates malformed artifact %s", async (text, reason) => {
    const runtime = await createDispatchRuntime(config, { readFile: vi.fn().mockResolvedValue(text) });
    expect(runtime.scoreCandidates([input])).toEqual({ status: "unavailable", reason });
  });
  it("requires checksum for production and verifies it", async () => {
    const reader = fakeReader();
    const missing = await createDispatchRuntime({ ...config, NODE_ENV: "production" }, reader);
    expect(missing.scoreCandidates([input])).toEqual({ status: "unavailable", reason: "missing_artifact_checksum" });
    expect(reader.readFile).not.toHaveBeenCalled();
    const mismatch = await createDispatchRuntime({ ...config, NODE_ENV: "production", ML_DISPATCH_MODEL_SHA256: "0".repeat(64) }, reader);
    expect(mismatch.scoreCandidates([input])).toEqual({ status: "unavailable", reason: "artifact_checksum_mismatch" });
    const ready = await createDispatchRuntime({ ...config, NODE_ENV: "production", ML_DISPATCH_MODEL_SHA256: checksum(JSON.stringify(real)) }, reader);
    expect(ready.status).toBe("ready");
  });
  it("rejects malformed optional checksum in development", async () => {
    const reader = fakeReader(); const runtime = await createDispatchRuntime({ ...config, ML_DISPATCH_MODEL_SHA256: "bad" }, reader);
    expect(runtime.scoreCandidates([input])).toEqual({ status: "unavailable", reason: "invalid_expected_checksum" });
    expect(reader.readFile).not.toHaveBeenCalled();
  });
  it.each(["development", "test", "production"])("enforces synthetic policy in %s", async mode => {
    for (const allow of ["false", "true"]) {
      const runtime = await createDispatchRuntime({ ...config, NODE_ENV: mode, ML_DISPATCH_ALLOW_SYNTHETIC: allow,
        ML_DISPATCH_MODEL_SHA256: checksum(JSON.stringify(synthetic)) }, fakeReader(synthetic));
      expect(runtime.status).toBe(mode !== "production" && allow === "true" ? "ready" : "unavailable");
      if (runtime.status === "unavailable") expect(runtime.scoreCandidates([input])).toEqual({ status: "unavailable", reason: "unsupported_provenance" });
    }
  });
  it.each(["development", "test", "production"])("rejects MIXED in %s", async mode => {
    const mixed = { ...real, trainingMetadata: { ...real.trainingMetadata, dataProvenance: "MIXED" } };
    const runtime = await createDispatchRuntime({ ...config, NODE_ENV: mode, ML_DISPATCH_ALLOW_SYNTHETIC: "true",
      ML_DISPATCH_MODEL_SHA256: checksum(JSON.stringify(mixed)) }, fakeReader(mixed));
    expect(runtime.scoreCandidates([input])).toEqual({ status: "unavailable", reason: "unsupported_provenance" });
  });
});

describe("shadow candidate scoring and safe observation", () => {
  it("ranks higher probabilities first without mutating input", async () => {
    const runtime = await createDispatchRuntime(config, fakeReader());
    const inputs = [input, { ...input, candidateKey: "second", riderDistanceKm: 10 }];
    const before = structuredClone(inputs); const result = runtime.scoreCandidates(inputs);
    expect(inputs).toEqual(before);
    if (result.status !== "predicted") throw new Error("unavailable");
    expect(result.candidates.map(c => c.shadowRank)).toEqual([2, 1]);
    expect(result.candidates[1].acceptanceProbability!).toBeGreaterThan(result.candidates[0].acceptanceProbability!);
    expect(result.modelVersion).toBe(real.modelVersion);
  });
  it("uses deterministic order before lexical key for tied scores", async () => {
    const runtime = await createDispatchRuntime(config, fakeReader());
    const result = runtime.scoreCandidates([{ ...input, candidateKey: "z" }, { ...input, candidateKey: "a" }]);
    if (result.status !== "predicted") throw new Error("unavailable");
    expect(result.candidates.map(c => c.shadowRank)).toEqual([1, 2]);
  });
  it("assembles exact snapshot features at UTC-offset Sunday midnight", async () => {
    const spy = vi.spyOn(DispatchAcceptanceModel.prototype, "predict");
    const runtime = await createDispatchRuntime({ ...config, ML_TIMEZONE_OFFSET_MINUTES: "-720" }, fakeReader());
    runtime.scoreCandidates([input]);
    expect(spy).toHaveBeenCalledWith({ riderDistanceKm: 1.25, activeWorkload: 0, hourOfDay: 0, dayOfWeek: 0 });
  });
  it.each([{ riderDistanceKm: -1 }, { activeWorkload: .5 }, { attemptedAt: new Date(NaN) }])("keeps invalid candidate unranked %j", async override => {
    const runtime = await createDispatchRuntime(config, fakeReader());
    const result = runtime.scoreCandidates([{ ...input, ...override }, { ...input, candidateKey: "valid" }]);
    if (result.status !== "predicted") throw new Error("unavailable");
    expect(result.candidates[0]).toMatchObject({ acceptanceProbability: null, shadowRank: null });
    expect(result.candidates[1].shadowRank).toBe(1);
  });
  it("isolates model-wide exceptions", async () => {
    const runtime = await createDispatchRuntime(config, fakeReader());
    vi.spyOn(DispatchAcceptanceModel.prototype, "predict").mockImplementation(() => { throw new Error("private"); });
    expect(runtime.scoreCandidates([input])).toEqual({ status: "unavailable", reason: "prediction_failed" });
  });
  it("projects aggregate data without keys or probability fields", async () => {
    const runtime = await createDispatchRuntime(config, fakeReader());
    const result = observeDispatchShadow(runtime, [input, { ...input, candidateKey: "second", riderDistanceKm: 10 }], 1, "ML_ASSISTED");
    expect(result).toMatchObject({ status: "predicted", candidateCount: 2, scoredCandidateCount: 2, selectedDeterministicRank: 1,
      selectedShadowRank: 2, deterministicTopRankAgreesWithShadow: false, selectionPolicy: "ML_ASSISTED" });
    expect(Object.keys(result).sort()).toEqual(["status", "candidateCount", "scoredCandidateCount", "selectedDeterministicRank", "selectedShadowRank", "selectionPolicy", "modelVersion", "dataProvenance", "deterministicTopRankAgreesWithShadow"].sort());
    expect(JSON.stringify(result)).not.toMatch(/opaque-local|second|candidateKey|riderId|orderId|acceptanceProbability|coordinates|address/);
  });
  it("projects disabled and thrown runtime states safely", () => {
    expect(observeDispatchShadow(disabledDispatchRuntime, [input], 1, "DETERMINISTIC_FALLBACK").status).toBe("disabled");
    expect(observeDispatchShadow({ status: "ready", scoreCandidates() { throw new Error("private"); } }, [input], 1, "DETERMINISTIC_FALLBACK"))
      .toMatchObject({ status: "unavailable", reason: "prediction_failed", scoredCandidateCount: 0 });
  });
  it("has no mutation or legacy dependency and wires startup separately", () => {
    const source = readFileSync(new URL("../src/ml/dispatch-runtime.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/LogisticsModel|predictDispatch|prisma|deliveryAssignment|console\./);
    const server = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
    expect(server.match(/await createDispatchRuntime\(/g)).toHaveLength(1);
    expect(server).toContain("createApp({ etaRuntime, dispatchShadowRuntime })");
    const service = readFileSync(new URL("../src/dispatch/dispatch.service.ts", import.meta.url), "utf8");
    expect(service).not.toMatch(/createDispatchRuntime|loadDispatchModelArtifact/);
  });
});
