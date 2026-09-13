import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DispatchAcceptanceModel } from "../src/ml/dispatch-model.js";
import type { DispatchAcceptanceFeatures } from "../src/ml/dispatch-features.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/dispatch-model-artifact.synthetic.test.json", import.meta.url), "utf8"));
const parity: { cases: { name: string; rawFeatures: DispatchAcceptanceFeatures; expectedAcceptanceProbability: number; modelVersion: string }[] } = JSON.parse(readFileSync(new URL("../../ml/dispatch/fixtures/prediction-parity.json", import.meta.url), "utf8"));
const raw = { riderDistanceKm: 1.25, activeWorkload: 2, hourOfDay: 12, dayOfWeek: 1 };

describe("isolated dispatch acceptance inference", () => {
  it.each(parity.cases)("matches Python parity $name", entry => {
    const result = new DispatchAcceptanceModel(fixture).predict(entry.rawFeatures);
    expect(result.status).toBe("predicted");
    if (result.status !== "predicted") throw new Error("fixture unavailable");
    expect(Math.abs(result.acceptanceProbability - entry.expectedAcceptanceProbability)).toBeLessThanOrEqual(1e-12);
    expect(result.modelVersion).toBe(entry.modelVersion);
    expect(result.dataProvenance).toBe("SYNTHETIC");
    expect(Number.isFinite(result.acceptanceProbability)).toBe(true);
    expect(result.acceptanceProbability).toBeGreaterThanOrEqual(0);
    expect(result.acceptanceProbability).toBeLessThanOrEqual(1);
  });
  it("applies encoding, means, scales, coefficients and intercept without rounding", () => {
    const a = structuredClone(fixture);
    a.preprocessing = { means: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0], scales: [2, 4, 1, 1, 1, 1, 1, 1, 1, 1] };
    a.coefficients = [2, -4, 0, .3, .2, 0, 0, 0, 0, 0];
    a.intercept = .7;
    // Noon => hourCos=-1; Monday=1. Logit=.25-1-.3+.2+.7=-.15.
    const result = new DispatchAcceptanceModel(a).predict(raw);
    if (result.status !== "predicted") throw new Error("unavailable");
    expect(result.acceptanceProbability).toBeCloseTo(Math.exp(-.15) / (1 + Math.exp(-.15)), 14);
    expect(result.acceptanceProbability).not.toBe(Number(result.acceptanceProbability.toFixed(2)));
    expect(result.acceptanceProbability).not.toBe(0);
    expect(result.acceptanceProbability).not.toBe(1);
    expect(Object.keys(result).sort()).toEqual(["acceptanceProbability", "dataProvenance", "modelVersion", "status"]);
  });
  it.each([-1000, 1000])("handles extreme logit %s", logit => {
    const a = { ...fixture, coefficients: Array(10).fill(0), intercept: logit };
    const result = new DispatchAcceptanceModel(a).predict(raw);
    expect(result).toMatchObject({ status: "predicted", acceptanceProbability: logit > 0 ? 1 : 0 });
  });
  it.each([
    ["riderDistanceKm", -1], ["riderDistanceKm", Infinity], ["riderDistanceKm", NaN], ["riderDistanceKm", "1"],
    ["activeWorkload", -1], ["activeWorkload", .5], ["activeWorkload", true],
    ["hourOfDay", 24], ["hourOfDay", -1], ["dayOfWeek", 7], ["dayOfWeek", -1], ["accepted", true],
  ])("rejects invalid feature %s=%s", (key, value) => {
    expect(new DispatchAcceptanceModel(fixture).predict({ ...raw, [key]: value } as DispatchAcceptanceFeatures)).toEqual({ status: "unavailable", reason: "invalid_features" });
  });
  it.each([null, [], {}, { ...fixture, modelType: "ridge" }, { ...fixture, coefficients: [1] }, { ...fixture, intercept: Infinity }])("rejects invalid artifact %j", a => {
    expect(new DispatchAcceptanceModel(a).predict(raw)).toEqual({ status: "unavailable", reason: "invalid_artifact" });
  });
  it("rejects nonfinite intermediate math", () => {
    const a = structuredClone(fixture);
    a.preprocessing.scales[0] = Number.MIN_VALUE;
    expect(new DispatchAcceptanceModel(a).predict(raw)).toEqual({ status: "unavailable", reason: "invalid_prediction" });
  });
  it("copies artifact and preserves frozen input deterministically", () => {
    const a = structuredClone(fixture), original = structuredClone(a);
    const input = Object.freeze({ ...raw });
    const model = new DispatchAcceptanceModel(a);
    const first = model.predict(input);
    expect(model.predict(input)).toEqual(first);
    expect(a).toEqual(original);
    a.coefficients.fill(999);
    a.preprocessing.means.fill(999);
    a.modelVersion = "mutated";
    expect(model.predict(input)).toEqual(first);
    expect(input).toEqual(raw);
  });
  it("maps noncloneable artifacts and throwing input to unavailable", () => {
    expect(new DispatchAcceptanceModel({ fn: () => 1 }).predict(raw)).toEqual({ status: "unavailable", reason: "invalid_artifact" });
    const input = new Proxy(raw, { ownKeys() { throw new Error("private"); } });
    expect(new DispatchAcceptanceModel(fixture).predict(input)).toEqual({ status: "unavailable", reason: "invalid_features" });
  });
  it("depends only on feature/artifact modules and exposes only predict", () => {
    const source = readFileSync(new URL("../src/ml/dispatch-model.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map(m => m[1]);
    expect(imports).toEqual(["./dispatch-features.js", "./dispatch-model.types.js"]);
    expect(Object.getOwnPropertyNames(DispatchAcceptanceModel.prototype)).toEqual(["constructor", "predict"]);
    expect(source).not.toMatch(/Prisma|LogisticsModel|process\.env|routeCompatibilityScore|predictDispatch|fetch\(/);
  });
});
