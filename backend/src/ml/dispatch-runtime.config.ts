export type DispatchRuntimeConfigResult =
  | { readonly status: "disabled" }
  | { readonly status: "unavailable"; readonly reason: "invalid_configuration" | "missing_model_path" | "missing_artifact_checksum" }
  | { readonly status: "configured"; readonly production: boolean; readonly allowSynthetic: boolean;
      readonly modelPath: string; readonly expectedSha256?: string; readonly timezoneOffsetMinutes: number };

/** Explicit dispatch-specific settings. Nothing is read at import time. */
export function loadDispatchRuntimeConfig(environment: NodeJS.ProcessEnv): DispatchRuntimeConfigResult {
  if (environment.ML_DISPATCH_SHADOW_ENABLED !== "true") return { status: "disabled" };
  const mode = environment.NODE_ENV ?? "development";
  const allow = environment.ML_DISPATCH_ALLOW_SYNTHETIC ?? "false";
  const offsetText = environment.ML_DISPATCH_TIMEZONE_OFFSET_MINUTES;
  if (!["production", "development", "test"].includes(mode) || !["true", "false"].includes(allow)
    || typeof offsetText !== "string" || !/^-?\d+$/.test(offsetText)) return { status: "unavailable", reason: "invalid_configuration" };
  const offset = Number(offsetText);
  if (!Number.isInteger(offset) || offset < -840 || offset > 840) return { status: "unavailable", reason: "invalid_configuration" };
  const modelPath = environment.ML_DISPATCH_MODEL_PATH;
  if (!modelPath?.trim()) return { status: "unavailable", reason: "missing_model_path" };
  const expectedSha256 = environment.ML_DISPATCH_MODEL_SHA256;
  if (mode === "production" && !expectedSha256) return { status: "unavailable", reason: "missing_artifact_checksum" };
  return { status: "configured", production: mode === "production", allowSynthetic: allow === "true", modelPath,
    expectedSha256, timezoneOffsetMinutes: offset };
}
