import "dotenv/config";

import { z } from "zod";

const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === ""
      ? undefined
      : value,
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === ""
      ? undefined
      : value,
  z.string().trim().url().optional(),
);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DIRECT_URL: z.string().trim().min(1, "DIRECT_URL is required"),
  JWT_SECRET: z
    .string()
    .trim()
    .min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.coerce.number().int().positive().default(3600),
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  SUPABASE_URL: optionalUrl,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_PRESCRIPTIONS_BUCKET: optionalString,
  PRESCRIPTION_SIGNED_URL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(300),
  PRESCRIPTION_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(20 * 1024 * 1024)
    .default(10 * 1024 * 1024),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const fields = parsedEnv.error.issues
    .map((issue) => issue.path.join("."))
    .filter(Boolean)
    .join(", ");

  throw new Error(
    `Invalid environment configuration${fields ? `: ${fields}` : "."}`,
  );
}

export const env = {
  nodeEnv: parsedEnv.data.NODE_ENV,
  port: parsedEnv.data.PORT,
  directUrl: parsedEnv.data.DIRECT_URL,
  jwtSecret: parsedEnv.data.JWT_SECRET,
  jwtExpiresIn: parsedEnv.data.JWT_EXPIRES_IN,
  corsAllowedOrigins: parsedEnv.data.CORS_ALLOWED_ORIGINS,
  supabaseUrl: parsedEnv.data.SUPABASE_URL,
  supabaseServiceRoleKey:
    parsedEnv.data.SUPABASE_SERVICE_ROLE_KEY,
  supabasePrescriptionsBucket:
    parsedEnv.data.SUPABASE_PRESCRIPTIONS_BUCKET,
  prescriptionSignedUrlTtlSeconds:
    parsedEnv.data.PRESCRIPTION_SIGNED_URL_TTL_SECONDS,
  prescriptionMaxFileBytes:
    parsedEnv.data.PRESCRIPTION_MAX_FILE_BYTES,
} as const;

export const isProduction = env.nodeEnv === "production";
