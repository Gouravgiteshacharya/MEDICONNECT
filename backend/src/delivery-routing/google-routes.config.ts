export interface GoogleRoutesConfig {
  enabled: boolean;
  apiKey: string | null;
  timeoutMs: number;
}

export const DEFAULT_GOOGLE_ROUTES_TIMEOUT_MS = 5_000;

export function loadGoogleRoutesConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleRoutesConfig {
  const enabledRaw = environment.GOOGLE_ROUTES_ENABLED ?? "false";
  if (enabledRaw !== "true" && enabledRaw !== "false") {
    throw new Error("GOOGLE_ROUTES_ENABLED must be true or false");
  }

  const timeoutMs = Number(
    environment.GOOGLE_ROUTES_TIMEOUT_MS ?? DEFAULT_GOOGLE_ROUTES_TIMEOUT_MS,
  );
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new Error(
      "GOOGLE_ROUTES_TIMEOUT_MS must be an integer from 1 through 60000",
    );
  }

  const apiKey = environment.GOOGLE_MAPS_API_KEY?.trim() || null;
  return { enabled: enabledRaw === "true", apiKey, timeoutMs };
}
