import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateEtaModelArtifact, type EtaModelArtifact } from "./eta-model.types.js";

export interface EtaArtifactReader {
  readFile(path: string, encoding: "utf8"): Promise<string>;
}
export type EtaArtifactLoadResult =
  | { readonly status: "loaded"; readonly artifact: EtaModelArtifact }
  | { readonly status: "unavailable"; readonly reason: "file_not_found" | "invalid_json" | "invalid_artifact" | "read_failed" | "invalid_path" | "artifact_too_large" | "invalid_size_limit" | "invalid_expected_checksum" | "artifact_checksum_mismatch" };

/** Explicit filesystem-only read. Size cap is checked on UTF-8 content before JSON parsing. */
export async function loadEtaModelArtifact(
  path: string, reader: EtaArtifactReader = { readFile },
  options: { readonly maxBytes?: number; readonly expectedSha256?: string } = {},
): Promise<EtaArtifactLoadResult> {
  if (typeof path !== "string" || !path.trim() || path.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    return { status: "unavailable", reason: "invalid_path" };
  }
  const maxBytes = options.maxBytes ?? 65_536;
  if (options.expectedSha256 !== undefined && !/^[a-fA-F0-9]{64}$/.test(options.expectedSha256)) return { status: "unavailable", reason: "invalid_expected_checksum" };
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return { status: "unavailable", reason: "invalid_size_limit" };
  let contents: string;
  try { contents = await reader.readFile(path, "utf8"); }
  catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    return { status: "unavailable", reason: code === "ENOENT" ? "file_not_found" : "read_failed" };
  }
  if (typeof contents !== "string") return { status: "unavailable", reason: "read_failed" };
  if (Buffer.byteLength(contents, "utf8") > maxBytes) return { status: "unavailable", reason: "artifact_too_large" };
  if (options.expectedSha256 !== undefined && createHash("sha256").update(contents, "utf8").digest("hex") !== options.expectedSha256.toLowerCase()) return { status: "unavailable", reason: "artifact_checksum_mismatch" };
  let value: unknown;
  try { value = JSON.parse(contents); }
  catch { return { status: "unavailable", reason: "invalid_json" }; }
  const validation = validateEtaModelArtifact(value);
  return validation.status === "valid" ? { status: "loaded", artifact: validation.artifact }
    : { status: "unavailable", reason: "invalid_artifact" };
}
