import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { UserRole } from "../generated/prisma/client.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    address: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(async (callback) => callback(prisma)),
  },
}));

const { prisma } = await import("../src/lib/prisma.js");
const { app } = await import("../src/app.js");

const prismaMock = prisma as unknown as {
  user: {
    findUnique: Mock;
  };
  address: {
    findFirst: Mock;
    update: Mock;
    deleteMany: Mock;
  };
};

const userId = "11111111-1111-4111-8111-111111111111";
const addressId = "22222222-2222-4222-8222-222222222222";

function authToken() {
  return signAuthToken({
    userId,
    role: UserRole.CUSTOMER,
  });
}

function authenticateRequest() {
  prismaMock.user.findUnique.mockResolvedValueOnce({
    id: userId,
    role: UserRole.CUSTOMER,
    isActive: true,
  });

  return `Bearer ${authToken()}`;
}

describe("shared security hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the health endpoint working with security middleware enabled", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("adds Helmet security headers to API responses", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["referrer-policy"]).toBeDefined();
  });

  it("standardizes oversized JSON body errors", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ email: "asha@example.com", data: "x".repeat(110_000) }));

    expect(response.status).toBe(413);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({
      error: "Request body is too large.",
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("standardizes malformed JSON body errors", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({
      error: "Malformed JSON body.",
      code: "MALFORMED_JSON",
    });
  });

  it("does not expose parser internals for malformed JSON", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":');

    expect(JSON.stringify(response.body)).not.toContain("Unexpected end");
    expect(JSON.stringify(response.body)).not.toContain("SyntaxError");
    expect(response.text).not.toContain("<html");
  });

  it("does not misclassify unexpected application SyntaxErrors as malformed JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const syntaxErrorApp = express();

    syntaxErrorApp.get("/boom", () => {
      throw new SyntaxError("Unexpected token from application code");
    });
    syntaxErrorApp.use(errorHandler);

    const response = await request(syntaxErrorApp).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Internal server error.",
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("keeps Zod validation errors sanitized", async () => {
    const response = await request(app).post("/api/v1/auth/register").send({
      name: "Asha Customer",
      email: "not-an-email",
      password: "correct-password",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid request body.",
      code: "VALIDATION_ERROR",
    });
    expect(JSON.stringify(response.body)).not.toContain("invalid_format");
  });

  it("rejects malformed addressId UUIDs before Prisma is called", async () => {
    const response = await request(app)
      .patch("/api/v1/users/me/addresses/not-a-uuid")
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ label: "Work" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid request body.",
      code: "VALIDATION_ERROR",
    });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.address.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.address.update).not.toHaveBeenCalled();
  });

  it("preserves valid UUID ownership behavior", async () => {
    prismaMock.address.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .patch(`/api/v1/users/me/addresses/${addressId}`)
      .set("Authorization", authenticateRequest())
      .send({ label: "Work" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "Address not found.",
      code: "ADDRESS_NOT_FOUND",
    });
    expect(prismaMock.address.findFirst).toHaveBeenCalledWith({
      where: { id: addressId, userId },
      select: { id: true },
    });
  });

  it("preserves unknown route JSON errors", async () => {
    const response = await request(app).get("/api/v1/not-a-route");

    expect(response.status).toBe(404);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({
      error: "Route not found.",
      code: "ROUTE_NOT_FOUND",
    });
  });

  it("does not return HTML error pages for standardized malformed requests", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{bad-json");

    expect(response.status).toBe(400);
    expect(response.type).toMatch(/json/);
    expect(response.text).not.toContain("<!DOCTYPE html>");
    expect(response.text).not.toContain("<html");
  });

  it("keeps standardized error content types as JSON", async () => {
    const response = await request(app)
      .delete("/api/v1/users/me/addresses/not-a-uuid")
      .set("Authorization", `Bearer ${authToken()}`);

    expect(response.status).toBe(400);
    expect(response.type).toMatch(/json/);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(prismaMock.address.deleteMany).not.toHaveBeenCalled();
  });
});
