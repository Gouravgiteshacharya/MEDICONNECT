import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadEtaModelArtifact } from "../src/ml/eta-model.loader.js";

const artifact = JSON.parse(readFileSync(new URL("./fixtures/eta-model-artifact.synthetic.test.json", import.meta.url), "utf8"));
describe("explicit ETA artifact loader", () => {
  it("uses the injected reader with exactly the explicit path and UTF-8", async () => {
    const readFile = vi.fn().mockResolvedValue(JSON.stringify(artifact));
    expect(await loadEtaModelArtifact("chosen.json", { readFile })).toEqual({ status: "loaded", artifact });
    expect(readFile).toHaveBeenCalledExactlyOnceWith("chosen.json", "utf8");
  });
  it.each([["ENOENT", "file_not_found"], ["EACCES", "read_failed"], [undefined, "read_failed"]])("maps %s without leaking error details", async (code, reason) => {
    const readFile = vi.fn().mockRejectedValue(Object.assign(new Error("SECRET path or credentials"), { code }));
    expect(await loadEtaModelArtifact("chosen.json", { readFile })).toEqual({ status: "unavailable", reason });
  });
  it.each(["{bad}", "", "undefined"])("rejects malformed JSON %s", async text => {
    expect(await loadEtaModelArtifact("chosen.json", { readFile: vi.fn().mockResolvedValue(text) }))
      .toEqual({ status: "unavailable", reason: "invalid_json" });
  });
  it.each([null, [], 5, { ...artifact, artifactSchemaVersion: "wrong" },
    { ...artifact, orderedFeatures: [...artifact.orderedFeatures].reverse() },
    { ...artifact, coefficients: [1] },
    { ...artifact, coefficients: Array(10).fill("Infinity") },
    { ...artifact, preprocessing: { means: Array(10).fill(0), scales: Array(10).fill(0) } },
    { ...artifact, trainingMetadata: { ...artifact.trainingMetadata, trainedAt: "invalid" } },
    { ...artifact, rawRows: [] },
  ])("rejects incompatible JSON artifact %j", async value => {
    expect(await loadEtaModelArtifact("chosen.json", { readFile: vi.fn().mockResolvedValue(JSON.stringify(value)) }))
      .toEqual({ status: "unavailable", reason: "invalid_artifact" });
  });
  it.each(["", " ", "https://example.com/model.json", "file:///model.json", "bad\0path"])("rejects path %s before any read", async path => {
    const readFile = vi.fn();
    expect(await loadEtaModelArtifact(path, { readFile })).toEqual({ status: "unavailable", reason: "invalid_path" });
    expect(readFile).not.toHaveBeenCalled();
  });
  it("checks UTF-8 byte size before parsing with inclusive size boundary", async () => {
    const text = JSON.stringify(artifact);
    expect((await loadEtaModelArtifact("chosen.json", { readFile: vi.fn().mockResolvedValue(text) }, { maxBytes: Buffer.byteLength(text) })).status).toBe("loaded");
    expect(await loadEtaModelArtifact("chosen.json", { readFile: vi.fn().mockResolvedValue("éé") }, { maxBytes: 3 }))
      .toEqual({ status: "unavailable", reason: "artifact_too_large" });
  });
  it.each([0, -1, Infinity, 1.5])("rejects invalid size limit %s", async maxBytes => {
    const readFile = vi.fn();
    expect(await loadEtaModelArtifact("chosen.json", { readFile }, { maxBytes })).toEqual({ status: "unavailable", reason: "invalid_size_limit" });
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("artifact checksum", () => {
  it("hashes the exact UTF-8 text parsed in a single read", async () => {
    const text = " \n" + JSON.stringify({ ...artifact, modelVersion: "test-�" }, null, 2) + "\n";
    const readFile = vi.fn().mockResolvedValueOnce(text).mockResolvedValue("{}");
    const checksum = createHash("sha256").update(text, "utf8").digest("hex");
    expect((await loadEtaModelArtifact("test.json", { readFile }, { expectedSha256: checksum.toUpperCase() })).status).toBe("loaded");
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(await loadEtaModelArtifact("test.json", { readFile: vi.fn().mockResolvedValue(text + " ") }, { expectedSha256: checksum })).toEqual({ status: "unavailable", reason: "artifact_checksum_mismatch" });
  });
  it.each(["", "bad", "g".repeat(64), "a".repeat(63)])("rejects malformed checksum %s before reading", async expectedSha256 => {
    const readFile = vi.fn();
    expect(await loadEtaModelArtifact("test.json", { readFile }, { expectedSha256 })).toEqual({ status: "unavailable", reason: "invalid_expected_checksum" });
    expect(readFile).not.toHaveBeenCalled();
  });
});
