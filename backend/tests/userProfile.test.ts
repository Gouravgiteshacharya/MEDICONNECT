import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { Prisma, UserRole } from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");

const prismaMock = prisma as unknown as {
  user: {
    create: Mock;
    findUnique: Mock;
    update: Mock;
  };
};

const userId = "11111111-1111-4111-8111-111111111111";
const createdAt = new Date("2026-01-02T03:04:05.000Z");
const updatedAt = new Date("2026-02-03T04:05:06.000Z");

const profileUser = {
  id: userId,
  name: "Asha Customer",
  email: "asha@example.com",
  phone: null,
  role: UserRole.CUSTOMER,
  isActive: true,
  createdAt,
  updatedAt,
};

function authUser(role: UserRole = UserRole.CUSTOMER) {
  return {
    id: userId,
    role,
    isActive: true,
  };
}

function authToken(role: UserRole = UserRole.CUSTOMER) {
  return signAuthToken({
    userId,
    role,
  });
}

function uniqueConstraintError(field: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: [field] },
  });
}

function recordNotFoundError() {
  return new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025",
    clientVersion: "test",
  });
}

function expectProfileBody(body: unknown, overrides = {}) {
  expect(body).toEqual({
    user: {
      id: userId,
      name: "Asha Customer",
      email: "asha@example.com",
      phone: null,
      role: UserRole.CUSTOMER,
      isActive: true,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      ...overrides,
    },
  });
}

describe("user profile API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/users/me", () => {
    it("allows an authenticated user to retrieve their own profile", async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce(authUser())
        .mockResolvedValueOnce(profileUser);

      const response = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`);

      expect(response.status).toBe(200);
      expectProfileBody(response.body);
      expect(prismaMock.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    it("never returns passwordHash in the profile response", async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce(authUser())
        .mockResolvedValueOnce({
          ...profileUser,
          passwordHash: "hashed-password",
        });

      const response = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.user.passwordHash).toBeUndefined();
      expect(response.body.passwordHash).toBeUndefined();
    });

    it("returns the current database role", async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce(authUser(UserRole.PHARMACY_STAFF))
        .mockResolvedValueOnce({
          ...profileUser,
          role: UserRole.PHARMACY_STAFF,
        });

      const response = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken(UserRole.CUSTOMER)}`);

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe(UserRole.PHARMACY_STAFF);
    });

    it("rejects unauthenticated requests", async () => {
      const response = await request(app).get("/api/v1/users/me");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Authentication required.",
        code: "AUTH_REQUIRED",
      });
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it("handles a user-not-found race deterministically", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser()).mockResolvedValueOnce(null);

      const response = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Invalid authentication token.",
        code: "INVALID_TOKEN",
      });
    });
  });

  describe("PATCH /api/v1/users/me", () => {
    it("updates only the name", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());
      prismaMock.user.update.mockResolvedValue({
        ...profileUser,
        name: "Updated Name",
      });

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ name: " Updated Name " });

      expect(response.status).toBe(200);
      expectProfileBody(response.body, { name: "Updated Name" });
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: userId },
          data: { name: "Updated Name" },
        }),
      );
    });

    it("updates only the email and normalizes it", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());
      prismaMock.user.update.mockResolvedValue({
        ...profileUser,
        email: "new@example.com",
      });

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ email: " NEW@EXAMPLE.COM " });

      expect(response.status).toBe(200);
      expectProfileBody(response.body, { email: "new@example.com" });
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { email: "new@example.com" },
        }),
      );
    });

    it("updates only the phone", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());
      prismaMock.user.update.mockResolvedValue({
        ...profileUser,
        phone: "9876543210",
      });

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ phone: " 9876543210 " });

      expect(response.status).toBe(200);
      expectProfileBody(response.body, { phone: "9876543210" });
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { phone: "9876543210" },
        }),
      );
    });

    it("allows clearing phone with null", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());
      prismaMock.user.update.mockResolvedValue({
        ...profileUser,
        phone: null,
      });

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ phone: null });

      expect(response.status).toBe(200);
      expectProfileBody(response.body, { phone: null });
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { phone: null },
        }),
      );
    });

    it("updates multiple allowed fields together", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());
      prismaMock.user.update.mockResolvedValue({
        ...profileUser,
        name: "Updated Name",
        email: "new@example.com",
        phone: "9876543210",
      });

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({
          name: "Updated Name",
          email: "new@example.com",
          phone: "9876543210",
        });

      expect(response.status).toBe(200);
      expectProfileBody(response.body, {
        name: "Updated Name",
        email: "new@example.com",
        phone: "9876543210",
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: "Updated Name",
            email: "new@example.com",
            phone: "9876543210",
          },
        }),
      );
    });

    it("rejects an empty body before Prisma update", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("rejects role updates before Prisma update", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ role: "ADMIN" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("rejects isActive updates before Prisma update", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ isActive: false });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("rejects passwordHash updates before Prisma update", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ passwordHash: "hashed-password" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("rejects id updates before Prisma update", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ id: "22222222-2222-4222-8222-222222222222" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("rejects password updates before Prisma update", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ password: "new-password" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("rejects malformed email before Prisma update", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ email: "not-an-email" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("rejects invalid names before Prisma update", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ name: "   " });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("rejects invalid phone before Prisma update", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ phone: "123" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("translates duplicate email conflicts", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());
      prismaMock.user.update.mockRejectedValue(uniqueConstraintError("email"));

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ email: "used@example.com" });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "An account with this email already exists.",
        code: "EMAIL_ALREADY_EXISTS",
      });
    });

    it("translates duplicate phone conflicts", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());
      prismaMock.user.update.mockRejectedValue(uniqueConstraintError("phone"));

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ phone: "9876543210" });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "An account with this phone already exists.",
        code: "PHONE_ALREADY_EXISTS",
      });
    });

    it("never returns passwordHash in the PATCH response", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());
      prismaMock.user.update.mockResolvedValue({
        ...profileUser,
        name: "Updated Name",
        passwordHash: "hashed-password",
      });

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ name: "Updated Name" });

      expect(response.status).toBe(200);
      expect(response.body.user.passwordHash).toBeUndefined();
      expect(response.body.passwordHash).toBeUndefined();
    });

    it("sends only explicitly allowed fields to Prisma update", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());
      prismaMock.user.update.mockResolvedValue({
        ...profileUser,
        name: "Updated Name",
        email: "new@example.com",
        phone: null,
      });

      await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({
          name: "Updated Name",
          email: "new@example.com",
          phone: null,
        });

      const updateArgs = prismaMock.user.update.mock.calls[0]?.[0];

      expect(updateArgs.data).toEqual({
        name: "Updated Name",
        email: "new@example.com",
        phone: null,
      });
      expect(updateArgs.data.role).toBeUndefined();
      expect(updateArgs.data.isActive).toBeUndefined();
      expect(updateArgs.data.passwordHash).toBeUndefined();
      expect(updateArgs.data.password).toBeUndefined();
      expect(updateArgs.data.id).toBeUndefined();
      expect(updateArgs.data.createdAt).toBeUndefined();
      expect(updateArgs.data.updatedAt).toBeUndefined();
    });

    it("handles a disappeared user during update deterministically", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authUser());
      prismaMock.user.update.mockRejectedValue(recordNotFoundError());

      const response = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ name: "Updated Name" });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Invalid authentication token.",
        code: "INVALID_TOKEN",
      });
    });
  });
});
