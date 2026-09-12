import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createEtaRuntime } from "../src/ml/eta-runtime.js";
import { CheckoutEtaModel } from "../src/ml/eta-model.js";
const real = readFileSync(new URL("./fixtures/eta-model-artifact.real-policy.test.json", import.meta.url), "utf8");
const synthetic = readFileSync(new URL("./fixtures/eta-model-artifact.synthetic.test.json", import.meta.url), "utf8");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const input = { deliveryDistanceKm: 2, placedAt: new Date("2026-09-13T00:00:00Z"), items: [null] };
const config = { ML_ETA_ENABLED: "true", ML_ETA_MODEL_PATH: "test.json", NODE_ENV: "test" };
async function runtime(env = {}, text = real) { return createEtaRuntime({ ...config, ...env }, { readFile: vi.fn().mockResolvedValue(text) }); }
describe("optional ETA shadow runtime", () => {
  it.each([undefined, "false", "invalid"])("disabled %s never reads or requires config", async ML_ETA_ENABLED => {
    const readFile = vi.fn(); const result = await createEtaRuntime({ ML_ETA_ENABLED }, { readFile });
    expect(result.status).toBe("disabled"); expect(result.predictOrderPlacement(input)).toEqual({ status: "disabled" }); expect(readFile).not.toHaveBeenCalled();
  });
  it("loads REAL policy fixture and returns continuous safe prediction", async () => {
    const result = (await runtime()).predictOrderPlacement(input);
    expect(result).toMatchObject({ status: "predicted", predictionPoint: "ORDER_PLACEMENT", dataProvenance: "REAL", modelVersion: "TEST-ONLY-real-policy-not-real-training" });
    expect(Object.keys(result).sort()).toEqual(["status", "predictionPoint", "predictedMinutes", "dataProvenance", "modelVersion"].sort());
    const expected = new CheckoutEtaModel(JSON.parse(real)).predict({ distanceKm: 2, itemCount: 1, hourOfDay: 5, dayOfWeek: 0 });
    expect(result).toMatchObject(expected);
  });
  it.each([
    [{ ML_ETA_MODEL_PATH: "" }, real, "missing_model_path"],
    [{ NODE_ENV: "production" }, real, "missing_artifact_checksum"],
    [{ ML_ETA_MODEL_SHA256: "0".repeat(64) }, real, "artifact_checksum_mismatch"],
    [{ ML_ETA_MODEL_SHA256: "bad" }, real, "invalid_expected_checksum"],
    [{}, "{", "invalid_json"], [{}, "{}", "invalid_artifact"],
    [{ NODE_ENV: "staging" }, real, "invalid_runtime_mode"],
    [{ ML_MAX_PREDICTION_MINUTES: "0" }, real, "invalid_configuration"],
    [{ ML_TIMEZONE_OFFSET_MINUTES: "0.5" }, real, "invalid_configuration"],
  ])("unavailable configuration/load case %j", async (env, text, reason) => {
    const result = await runtime(env, text); expect(result.status).toBe("unavailable"); expect(result.predictOrderPlacement(input)).toEqual({ status: "unavailable", reason });
  });
  it.each(["ENOENT", "EACCES"])("isolates read failure %s", async code => {
    const result = await createEtaRuntime(config, { readFile: vi.fn().mockRejectedValue(Object.assign(new Error("PRIVATE"), { code })) });
    expect(result.status).toBe("unavailable"); expect(JSON.stringify(result.predictOrderPlacement(input))).not.toContain("PRIVATE");
  });
  it("accepts matching production checksum", async () => expect((await runtime({ NODE_ENV: "production", ML_ETA_MODEL_SHA256: sha(real) })).status).toBe("ready"));
  it.each(["production", "development", "test"])("enforces synthetic policy in %s", async NODE_ENV => {
    expect((await runtime({ NODE_ENV, ML_ETA_MODEL_SHA256: sha(synthetic) }, synthetic)).status).toBe("unavailable");
    expect((await runtime({ NODE_ENV, ML_ETA_MODEL_SHA256: sha(synthetic), ML_ETA_ALLOW_SYNTHETIC: "true" }, synthetic)).status).toBe(NODE_ENV === "production" ? "unavailable" : "ready");
  });
  it.each(["production", "development", "test"])("rejects MIXED in %s", async NODE_ENV => {
    const value = JSON.parse(real); value.trainingMetadata.dataProvenance = "MIXED"; const text = JSON.stringify(value);
    expect((await runtime({ NODE_ENV, ML_ETA_MODEL_SHA256: sha(text), ML_ETA_ALLOW_SYNTHETIC: "true" }, text)).status).toBe("unavailable");
  });
  it.each([0, -1, 241])("rejects constant prediction %s without clamping", async intercept => {
    const artifact = JSON.parse(real); artifact.coefficients.fill(0); artifact.intercept = intercept;
    expect((await runtime({}, JSON.stringify(artifact))).predictOrderPlacement(input).status).toBe("unavailable");
  });
  it("isolates model exceptions and nonfinite output", async () => {
    const result = await runtime(); const spy = vi.spyOn(CheckoutEtaModel.prototype, "predict").mockImplementation(() => { throw new Error("PRIVATE"); });
    try { expect(result.predictOrderPlacement(input)).toEqual({ status: "unavailable", reason: "prediction_failed" }); } finally { spy.mockRestore(); }
    const value = JSON.parse(real); value.coefficients.fill(1e308);
    expect((await runtime({}, JSON.stringify(value))).predictOrderPlacement({ ...input, deliveryDistanceKm: 1e308 }).status).toBe("unavailable");
  });
  it("invalid features do not escape", async () => expect((await runtime()).predictOrderPlacement(null as never).status).toBe("unavailable"));
});
