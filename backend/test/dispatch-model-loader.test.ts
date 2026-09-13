import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadDispatchModelArtifact } from "../src/ml/dispatch-model.loader.js";

const artifact = JSON.parse(readFileSync(new URL("./fixtures/dispatch-model-artifact.synthetic.test.json", import.meta.url), "utf8"));
describe("explicit dispatch artifact loader", () => {
  it("uses the injected reader with exactly the explicit path and UTF-8", async () => {
    const readFile = vi.fn().mockResolvedValue(JSON.stringify(artifact));
    expect(await loadDispatchModelArtifact("chosen.json", { readFile })).toEqual({ status: "loaded", artifact });
    expect(readFile).toHaveBeenCalledExactlyOnceWith("chosen.json", "utf8");
  });
  it.each([["ENOENT", "file_not_found"], ["EACCES", "read_failed"], [undefined, "read_failed"]])("maps %s without leaking error details", async (code, reason) => {
    const readFile = vi.fn().mockRejectedValue(Object.assign(new Error("SECRET path or credentials"), { code }));
    expect(await loadDispatchModelArtifact("chosen.json", { readFile })).toEqual({ status: "unavailable", reason });
  });
  it.each(["{bad}", "", "undefined"])("rejects malformed JSON %s", async text => {
    expect(await loadDispatchModelArtifact("chosen.json", { readFile: vi.fn().mockResolvedValue(text) }))
      .toEqual({ status: "unavailable", reason: "invalid_json" });
  });
  it.each([null, [], 5, { ...artifact, artifactSchemaVersion: "wrong" }, { ...artifact, modelType: "ridge" },
    { ...artifact, orderedFeatures: [...artifact.orderedFeatures].reverse() },
    { ...artifact, coefficients: [1] },
    { ...artifact, coefficients: Array(10).fill("Infinity") },
    { ...artifact, preprocessing: { means: Array(10).fill(0), scales: Array(10).fill(0) } },
    { ...artifact, trainingMetadata: { ...artifact.trainingMetadata, trainedAt: "invalid" } },
    { ...artifact, rawRows: [] },
  ])("rejects incompatible JSON artifact %j", async value => {
    expect(await loadDispatchModelArtifact("chosen.json", { readFile: vi.fn().mockResolvedValue(JSON.stringify(value)) }))
      .toEqual({ status: "unavailable", reason: "invalid_artifact" });
  });
  it.each(["", " ", "https://example.com/model.json", "file:///model.json", "bad\0path", "data:application/json,{}", "file:model.json"])("rejects path %s before any read", async path => {
    const readFile = vi.fn();
    expect(await loadDispatchModelArtifact(path, { readFile })).toEqual({ status: "unavailable", reason: "invalid_path" });
    expect(readFile).not.toHaveBeenCalled();
  });
  it("checks UTF-8 byte size before parsing with inclusive size boundary", async () => {
    const text = JSON.stringify(artifact);
    expect((await loadDispatchModelArtifact("chosen.json", { readFile: vi.fn().mockResolvedValue(text) }, { maxBytes: Buffer.byteLength(text) })).status).toBe("loaded");
    expect(await loadDispatchModelArtifact("chosen.json", { readFile: vi.fn().mockResolvedValue("Ã©Ã©") }, { maxBytes: 3 }))
      .toEqual({ status: "unavailable", reason: "artifact_too_large" });
  });
  it.each([0, -1, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid size limit %s", async maxBytes => {
    const readFile = vi.fn();
    expect(await loadDispatchModelArtifact("chosen.json", { readFile }, { maxBytes })).toEqual({ status: "unavailable", reason: "invalid_size_limit" });
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("artifact checksum", () => {
  it("hashes the exact UTF-8 text parsed in a single read", async () => {
    const text = " \n" + JSON.stringify({ ...artifact, modelVersion: "test-é" }, null, 2) + "\n";
    const readFile = vi.fn().mockResolvedValueOnce(text).mockResolvedValue("{}");
    const checksum = createHash("sha256").update(text, "utf8").digest("hex");
    expect((await loadDispatchModelArtifact("test.json", { readFile }, { expectedSha256: checksum.toUpperCase() })).status).toBe("loaded");
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(await loadDispatchModelArtifact("test.json", { readFile: vi.fn().mockResolvedValue(text + " ") }, { expectedSha256: checksum })).toEqual({ status: "unavailable", reason: "artifact_checksum_mismatch" });
  });
  it.each(["", "bad", "g".repeat(64), "a".repeat(63)])("rejects malformed checksum %s before reading", async expectedSha256 => {
    const readFile = vi.fn();
    expect(await loadDispatchModelArtifact("test.json", { readFile }, { expectedSha256 })).toEqual({ status: "unavailable", reason: "invalid_expected_checksum" });
    expect(readFile).not.toHaveBeenCalled();
  });
});

it("rejects default-limit overflow and non-string reader results", async () => {
  expect(await loadDispatchModelArtifact("x.json", { readFile: vi.fn().mockResolvedValue(" ".repeat(65_537)) })).toEqual({ status: "unavailable", reason: "artifact_too_large" });
  expect(await loadDispatchModelArtifact("x.json", { readFile: vi.fn().mockResolvedValue(null) })).toEqual({ status: "unavailable", reason: "read_failed" });
});
it("rejects runtime-invalid options without reading", async () => {
  const readFile = vi.fn();
  expect(await loadDispatchModelArtifact("x.json", { readFile }, { expectedSha256: 5 as unknown as string })).toEqual({ status: "unavailable", reason: "invalid_expected_checksum" });
  expect(await loadDispatchModelArtifact("x.json", { readFile }, { maxBytes: null as unknown as number })).toEqual({ status: "unavailable", reason: "invalid_size_limit" });
  expect(readFile).not.toHaveBeenCalled();
});
it("accepts an explicit Windows path", async () => {
  const readFile = vi.fn().mockResolvedValue(JSON.stringify(artifact));
  expect((await loadDispatchModelArtifact("C:/models/test.json", { readFile })).status).toBe("loaded");
});
it("has no environment lookup, discovery or network dependency", () => {
  const source = readFileSync(new URL("../src/ml/dispatch-model.loader.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/process\.env|fetch\(|readdir|glob|Prisma|https?:/);
});
