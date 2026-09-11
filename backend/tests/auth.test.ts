import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { Prisma, UserRole } from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { ApiError } from "../src/utils/ApiError.js";
import { signAuthToken, verifyAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");

const prismaMock = prisma as unknown as {
  user: {
    create: Mock;
    findUnique: Mock;
  };
};

const baseUser = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Asha Customer",
  email: "asha@example.com",
  phone: null,
  passwordHash: "$2b$12$wJ0xy3u6kGCXi.pwvN7ZXe0VTYxRSBpqs9N..YHkvAXCe.EhzpGiS",
  role: UserRole.CUSTOMER,
  isActive: true,
};

function uniqueConstraintError(field: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: [field] },
  });
}

describe("auth API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("registration", () => {
    it("registers a customer and never returns passwordHash", async () => {
      prismaMock.user.create.mockImplementation(async ({ data }) => ({
        ...baseUser,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
      }));

      const response = await request(app).post("/api/v1/auth/register").send({
        name: "Asha Customer",
        email: "ASHA@EXAMPLE.COM",
        password: "correct-password",
      });

      expect(response.status).toBe(201);
      expect(response.body.token).toEqual(expect.any(String));
      expect(response.body.user).toEqual({
        id: baseUser.id,
        name: baseUser.name,
        email: "asha@example.com",
        phone: null,
        role: UserRole.CUSTOMER,
      });
      expect(response.body.user.passwordHash).toBeUndefined();
      expect(response.body.passwordHash).toBeUndefined();

      const createArgs = prismaMock.user.create.mock.calls[0]?.[0];
      expect(createArgs.data.role).toBe(UserRole.CUSTOMER);
      expect(createArgs.data.passwordHash).not.toBe("correct-password");
      await expect(
        bcrypt.compare("correct-password", createArgs.data.passwordHash),
      ).resolves.toBe(true);
    });

    it("does not allow public registration to self-select a role", async () => {
      const response = await request(app).post("/api/v1/auth/register").send({
        name: "Asha Customer",
        email: "asha@example.com",
        password: "correct-password",
        role: "ADMIN",
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "Invalid request body.",
        code: "VALIDATION_ERROR",
      });
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it("returns a deterministic duplicate-email error", async () => {
      prismaMock.user.create.mockRejectedValue(uniqueConstraintError("email"));

      const response = await request(app).post("/api/v1/auth/register").send({
        name: "Asha Customer",
        email: "asha@example.com",
        password: "correct-password",
      });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "An account with this email already exists.",
        code: "EMAIL_ALREADY_EXISTS",
      });
    });

    it("returns a deterministic duplicate-phone error", async () => {
      prismaMock.user.create.mockRejectedValue(uniqueConstraintError("phone"));

      const response = await request(app).post("/api/v1/auth/register").send({
        name: "Asha Customer",
        email: "asha@example.com",
        phone: "9876543210",
        password: "correct-password",
      });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "An account with this phone already exists.",
        code: "PHONE_ALREADY_EXISTS",
      });
    });
  });

  describe("login", () => {
    it("logs in an active user and issues a token", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 12);
      prismaMock.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash,
      });

      const response = await request(app).post("/api/v1/auth/login").send({
        email: "ASHA@EXAMPLE.COM",
        password: "correct-password",
      });

      expect(response.status).toBe(200);
      expect(response.body.token).toEqual(expect.any(String));
      expect(response.body.user.passwordHash).toBeUndefined();
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: "asha@example.com" },
        }),
      );
    });

    it("uses the same error for an incorrect password", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 12);
      prismaMock.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash,
      });

      const response = await request(app).post("/api/v1/auth/login").send({
        email: "asha@example.com",
        password: "wrong-password",
      });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Invalid email or password.",
        code: "INVALID_CREDENTIALS",
      });
    });

    it("uses the same error for a nonexistent email", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const response = await request(app).post("/api/v1/auth/login").send({
        email: "missing@example.com",
        password: "wrong-password",
      });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Invalid email or password.",
        code: "INVALID_CREDENTIALS",
      });
    });

    it("rejects inactive accounts without issuing a token", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 12);
      prismaMock.user.findUnique.mockResolvedValue({
        ...baseUser,
        isActive: false,
        passwordHash,
      });

      const response = await request(app).post("/api/v1/auth/login").send({
        email: "asha@example.com",
        password: "correct-password",
      });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Account is inactive.",
        code: "ACCOUNT_INACTIVE",
      });
      expect(response.body.token).toBeUndefined();
    });
  });

  describe("JWT", () => {
    it("verifies a valid minimal auth token", () => {
      const token = signAuthToken({
        userId: baseUser.id,
        role: UserRole.CUSTOMER,
      });

      const payload = verifyAuthToken(token);

      expect(payload.sub).toBe(baseUser.id);
      expect(payload.role).toBe(UserRole.CUSTOMER);
      expect(payload.exp).toEqual(expect.any(Number));
      expect(payload.email).toBeUndefined();
      expect(payload.name).toBeUndefined();
    });

    it("rejects malformed JWTs", () => {
      expect(() => verifyAuthToken("not-a-jwt")).toThrow(ApiError);
    });

    it("rejects expired JWTs", () => {
      const token = jwt.sign({ role: UserRole.CUSTOMER }, process.env.JWT_SECRET!, {
        subject: baseUser.id,
        expiresIn: -1,
      });

      expect(() => verifyAuthToken(token)).toThrow(ApiError);
    });

    it("rejects invalid signatures", () => {
      const token = jwt.sign({ role: UserRole.CUSTOMER }, "different-secret", {
        subject: baseUser.id,
        expiresIn: 3600,
      });

      expect(() => verifyAuthToken(token)).toThrow(ApiError);
    });

    it("rejects signed JWTs with invalid roles before querying Prisma", async () => {
      const token = jwt.sign({ role: "SUPER_ADMIN" }, process.env.JWT_SECRET!, {
        algorithm: "HS256",
        subject: baseUser.id,
        expiresIn: 3600,
      });

      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Invalid authentication token.",
        code: "INVALID_TOKEN",
      });
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("authenticate and me", () => {
    it("requires an Authorization header", async () => {
      const response = await request(app).get("/api/v1/auth/me");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Authentication required.",
        code: "AUTH_REQUIRED",
      });
    });

    it("rejects malformed Bearer headers", async () => {
      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Invalid authentication token.",
        code: "INVALID_TOKEN",
      });
    });

    it("rejects invalid tokens", async () => {
      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer invalid-token");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Invalid authentication token.",
        code: "INVALID_TOKEN",
      });
    });

    it("rejects signed JWTs with malformed UUID subjects before querying Prisma", async () => {
      const token = jwt.sign({ role: UserRole.CUSTOMER }, process.env.JWT_SECRET!, {
        algorithm: "HS256",
        subject: "not-a-valid-uuid",
        expiresIn: 3600,
      });

      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Invalid authentication token.",
        code: "INVALID_TOKEN",
      });
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it("rejects inactive users after token verification", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...baseUser,
        isActive: false,
      });
      const token = signAuthToken({
        userId: baseUser.id,
        role: UserRole.CUSTOMER,
      });

      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Account is inactive.",
        code: "ACCOUNT_INACTIVE",
      });
    });

    it("returns the current database user for authenticated requests", async () => {
      prismaMock.user.findUnique.mockResolvedValue(baseUser);
      const token = signAuthToken({
        userId: baseUser.id,
        role: UserRole.CUSTOMER,
      });

      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: {
          id: baseUser.id,
          name: baseUser.name,
          email: baseUser.email,
          phone: baseUser.phone,
          role: baseUser.role,
        },
      });
      expect(response.body.user.passwordHash).toBeUndefined();
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: baseUser.id },
        }),
      );
    });

    it("uses the current database role instead of a stale valid token role", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...baseUser,
        role: UserRole.PHARMACY_STAFF,
      });
      const token = signAuthToken({
        userId: baseUser.id,
        role: UserRole.CUSTOMER,
      });

      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe(UserRole.PHARMACY_STAFF);
    });
  });

  describe("validation", () => {
    it("rejects invalid email during registration", async () => {
      const response = await request(app).post("/api/v1/auth/register").send({
        name: "Asha Customer",
        email: "not-an-email",
        password: "correct-password",
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });

    it("rejects weak passwords during registration", async () => {
      const response = await request(app).post("/api/v1/auth/register").send({
        name: "Asha Customer",
        email: "asha@example.com",
        password: "short",
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });

    it("rejects missing required fields", async () => {
      const response = await request(app).post("/api/v1/auth/register").send({
        email: "asha@example.com",
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });
  });
});
