import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { errorHandler } from "../src/middleware/errorHandler.js";
import { createRateLimiter } from "../src/middleware/rateLimit.js";

describe("public write rate limiting", () => {
  it("returns a sanitized 429 with retry guidance after the configured limit", async () => {
    let now = 1_000;
    const app = express();
    app.use(createRateLimiter({ keyPrefix: "test", max: 2, windowMs: 60_000, now: () => now }));
    app.get("/", (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(200);
    const limited = await request(app).get("/");

    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.body).toEqual({
      error: "Too many requests. Please wait and try again.",
      code: "RATE_LIMITED",
    });

    now += 60_000;
    expect((await request(app).get("/")).status).toBe(200);
  });
});
