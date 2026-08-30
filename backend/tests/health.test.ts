import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.js";

describe("health API", () => {
  it("returns a stable health payload", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("returns a standardized JSON error for unknown API routes", async () => {
    const response = await request(app).get("/api/v1/not-a-route");

    expect(response.status).toBe(404);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({
      error: "Route not found.",
      code: "ROUTE_NOT_FOUND",
    });
  });
});
