import type { RequestHandler } from "express";

import { ApiError } from "../utils/ApiError.js";

type Entry = { count: number; resetAt: number };

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
  now?: () => number;
};

export function createRateLimiter({ windowMs, max, keyPrefix, now = Date.now }: RateLimitOptions): RequestHandler {
  const entries = new Map<string, Entry>();

  return (req, res, next) => {
    const timestamp = now();
    const identity = req.user?.id || req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${identity}`;
    let entry = entries.get(key);

    if (!entry || entry.resetAt <= timestamp) {
      entry = { count: 0, resetAt: timestamp + windowMs };
      entries.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1000));

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      next(new ApiError(429, "Too many requests. Please wait and try again.", "RATE_LIMITED"));
      return;
    }

    if (entries.size > 10_000) {
      for (const [candidateKey, candidate] of entries) {
        if (candidate.resetAt <= timestamp) entries.delete(candidateKey);
      }
    }

    next();
  };
}

export const authLoginRateLimit = createRateLimiter({
  keyPrefix: "auth-login",
  windowMs: 15 * 60 * 1000,
  max: 30,
});

export const authRegisterRateLimit = createRateLimiter({
  keyPrefix: "auth-register",
  windowMs: 60 * 60 * 1000,
  max: 10,
});

export const partnerApplicationRateLimit = createRateLimiter({
  keyPrefix: "partner-application",
  windowMs: 60 * 60 * 1000,
  max: 10,
});

export const prescriptionUploadRateLimit = createRateLimiter({
  keyPrefix: "prescription-upload",
  windowMs: 60 * 60 * 1000,
  max: 100,
});
