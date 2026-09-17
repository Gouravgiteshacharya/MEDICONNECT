import type { CorsOptions } from "cors";
import { env } from "./env.js";

export function createCorsOptions(
  nodeEnv: string = env.nodeEnv,
  configuredOrigins: string = env.corsAllowedOrigins,
): CorsOptions {
  const allowedOrigins = new Set(configuredOrigins.split(",").map((value) => value.trim()).filter(Boolean));
  return {
    origin(origin, callback) {
      // Non-browser callers do not need CORS permission.
      if (!origin) return callback(null, false);
      const local = nodeEnv !== "production" &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(origin);
      callback(null, allowedOrigins.has(origin) || local);
    },
  };
}
