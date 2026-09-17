import cors from "cors";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createCorsOptions } from "../src/config/cors.js";

function appFor(mode: string, origins = "") {
  const app = express();
  app.use(cors(createCorsOptions(mode, origins)));
  app.get("/probe", (_req, res) => res.json({ ok: true }));
  return app;
}
describe("CORS policy", () => {
  it.each(["https://app.example.com", "https://admin.example.com"])("permits configured production origin %s", async (origin) => {
    const response = await request(appFor("production", " https://app.example.com, ,https://admin.example.com, ")).get("/probe").set("Origin", origin);
    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(response.headers.vary).toContain("Origin");
  });
  it.each(["https://evil.example", "https://app.example.com.evil.test", "https://sub.app.example.com", "http://app.example.com", "https://app.example.com:444", "null", "http://localhost:5173"])("does not grant unapproved production origin %s", async (origin) => {
    const response = await request(appFor("production", "https://app.example.com")).get("/probe").set("Origin", origin);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it.each(["", " , , ", "*"])("fails closed with empty/wildcard allowlist %s", async (origins) => {
    const response = await request(appFor("production", origins)).get("/probe").set("Origin", "https://external.test");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("keeps requests without Origin usable in production", async () => {
    const response = await request(appFor("production")).get("/probe");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
  it.each(["http://localhost:5173", "http://127.0.0.1:4173", "https://localhost:3000"])("allows local development origin %s", async (origin) => {
    const response = await request(appFor("development")).get("/probe").set("Origin", origin);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
  });
  it.each(["https://external.test", "http://localhost.evil.test:5173", "http://127.0.0.1.evil.test", "http://localhost:5173/path", "null"])("denies external/spoofed development origin %s", async (origin) => {
    const response = await request(appFor("development")).get("/probe").set("Origin", origin);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("allows explicitly configured external development origins", async () => {
    const origin = "https://preview.example.com";
    const response = await request(appFor("development", origin)).get("/probe").set("Origin", origin);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
  });
  it("handles allowed preflight without enabling credentials", async () => {
    const origin = "https://app.example.com";
    const response = await request(appFor("production", origin)).options("/probe").set("Origin", origin).set("Access-Control-Request-Method", "GET").set("Access-Control-Request-Headers", "authorization");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-headers"]).toBe("authorization");
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});
