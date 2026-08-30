import bcrypt from "bcrypt";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { z } from "zod";

import {
  PharmacyStaffRole,
  Prisma,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { authenticate } from "../src/middleware/authenticate.js";
import { authorizeRoles } from "../src/middleware/authorizeRoles.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { validateRequest } from "../src/middleware/validateRequest.js";
import { getActivePharmacyMembership } from "../src/services/pharmacyMembership.service.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pharmacyStaff: {
      findFirst: vi.fn(),
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

const prismaMock = prisma as unknown as {
  user: {
    create: Mock;
    findUnique: Mock;
    update: Mock;
  };
  pharmacyStaff: {
    findFirst: Mock;
  };
  address: {
    count: Mock;
    findMany: Mock;
    findFirst: Mock;
    create: Mock;
    update: Mock;
    updateMany: Mock;
    deleteMany: Mock;
  };
  $transaction: Mock;
};

const userId = "11111111-1111-4111-8111-111111111111";
const addressId = "22222222-2222-4222-8222-222222222222";
const pharmacyId = "33333333-3333-4333-8333-333333333333";
const otherPharmacyId = "44444444-4444-4444-8444-444444444444";
const otherUserId = "55555555-5555-4555-8555-555555555555";
const membershipId = "66666666-6666-4666-8666-666666666666";
const createdAt = new Date("2026-05-06T07:08:09.000Z");
const updatedAt = new Date("2026-06-07T08:09:10.000Z");

const baseUser = {
  id: userId,
  name: "Asha Customer",
  email: "asha@example.com",
  phone: null,
  passwordHash: "$2b$12$wJ0xy3u6kGCXi.pwvN7ZXe0VTYxRSBpqs9N..YHkvAXCe.EhzpGiS",
  role: UserRole.CUSTOMER,
  isActive: true,
  createdAt,
  updatedAt,
};

const baseAddress = {
  id: addressId,
  userId,
  label: "Home",
  addressLine1: "123 Main Road",
  addressLine2: null,
  landmark: null,
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
  latitude: null,
  longitude: null,
  isDefault: false,
  createdAt,
  updatedAt,
};

function authToken(role: UserRole = UserRole.CUSTOMER) {
  return signAuthToken({
    userId,
    role,
  });
}

function authenticatedUser(role: UserRole = UserRole.CUSTOMER, isActive = true) {
  return {
    id: userId,
    role,
    isActive,
  };
}

function authenticatedHeader(role: UserRole = UserRole.CUSTOMER) {
  prismaMock.user.findUnique.mockResolvedValueOnce(authenticatedUser(role));

  return `Bearer ${authToken(role)}`;
}

function uniqueConstraintError(field: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: [field] },
  });
}

function buildRoleApp(...allowedRoles: UserRole[]) {
  const roleApp = express();

  roleApp.get(
    "/protected",
    authenticate,
    authorizeRoles(...allowedRoles),
    (req, res) => {
      res.status(200).json({ id: req.user?.id, role: req.user?.role });
    },
  );
  roleApp.use(errorHandler);

  return roleApp;
}

function buildValidationApp() {
  const validationApp = express();

  validationApp.use(express.json());
  validationApp.get(
    "/query",
    validateRequest({
      query: z
        .object({
          page: z.coerce.number().int().positive(),
        })
        .strict(),
    }),
    (req, res) => {
      res.status(200).json({
        page: req.query.page,
        valueType: typeof req.query.page,
      });
    },
  );
  validationApp.post(
    "/body",
    validateRequest(
      z
        .object({
          name: z.string().trim().min(1),
        })
        .strict(),
    ),
    (req, res) => {
      res.status(200).json(req.body);
    },
  );
  validationApp.get(
    "/params/:itemId",
    validateRequest({
      params: z
        .object({
          itemId: z.string().uuid(),
        })
        .strict(),
    }),
    (req, res) => {
      res.status(200).json({ itemId: req.params.itemId });
    },
  );
  validationApp.use(errorHandler);

  return validationApp;
}

describe("Platform Core integration contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prisma));
  });

  describe("authentication composition", () => {
    it("registers customers with the CUSTOMER role and rejects self-selected roles", async () => {
      prismaMock.user.create.mockImplementation(async ({ data }) => ({
        ...baseUser,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
      }));

      const created = await request(app).post("/api/v1/auth/register").send({
        name: "Asha Customer",
        email: "ASHA@EXAMPLE.COM",
        password: "correct-password",
      });

      expect(created.status).toBe(201);
      expect(created.body.user.role).toBe(UserRole.CUSTOMER);
      expect(prismaMock.user.create.mock.calls[0]?.[0].data.role).toBe(
        UserRole.CUSTOMER,
      );

      const rejected = await request(app).post("/api/v1/auth/register").send({
        name: "Asha Customer",
        email: "asha@example.com",
        password: "correct-password",
        role: UserRole.ADMIN,
      });

      expect(rejected.status).toBe(400);
      expect(rejected.body.code).toBe("VALIDATION_ERROR");
    });

    it("issues a login JWT that can access an authenticated route", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 12);
      prismaMock.user.findUnique
        .mockResolvedValueOnce({
          ...baseUser,
          passwordHash,
        })
        .mockResolvedValueOnce(authenticatedUser())
        .mockResolvedValueOnce(baseUser);

      const login = await request(app).post("/api/v1/auth/login").send({
        email: "ASHA@EXAMPLE.COM",
        password: "correct-password",
      });

      expect(login.status).toBe(200);
      expect(login.body.token).toEqual(expect.any(String));

      const me = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${login.body.token}`);

      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe("asha@example.com");
    });

    it("keeps 401 contracts for missing, invalid, inactive, and deleted-token users", async () => {
      const missing = await request(app).get("/api/v1/auth/me");

      expect(missing.status).toBe(401);
      expect(missing.body.code).toBe("AUTH_REQUIRED");

      const invalid = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer invalid-token");

      expect(invalid.status).toBe(401);
      expect(invalid.body.code).toBe("INVALID_TOKEN");

      prismaMock.user.findUnique.mockResolvedValueOnce(authenticatedUser(UserRole.CUSTOMER, false));

      const inactive = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${authToken()}`);

      expect(inactive.status).toBe(401);
      expect(inactive.body.code).toBe("ACCOUNT_INACTIVE");

      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const deleted = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${authToken()}`);

      expect(deleted.status).toBe(401);
      expect(deleted.body.code).toBe("INVALID_TOKEN");
    });

    it("uses the current database role instead of a stale JWT role", async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce(authenticatedUser(UserRole.PHARMACY_STAFF))
        .mockResolvedValueOnce({
          ...baseUser,
          role: UserRole.PHARMACY_STAFF,
        });

      const response = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken(UserRole.CUSTOMER)}`);

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe(UserRole.PHARMACY_STAFF);
    });
  });

  describe("RBAC composition", () => {
    it("returns 401 before role authorization when unauthenticated", async () => {
      const response = await request(buildRoleApp(UserRole.ADMIN)).get("/protected");

      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTH_REQUIRED");
    });

    it("returns 403 when authenticated with the wrong global role", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authenticatedUser(UserRole.CUSTOMER));

      const response = await request(buildRoleApp(UserRole.ADMIN))
        .get("/protected")
        .set("Authorization", `Bearer ${authToken()}`);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: "You do not have permission to perform this action.",
        code: "FORBIDDEN",
      });
    });

    it("allows the correct global role and multiple permitted roles", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(
        authenticatedUser(UserRole.PHARMACY_STAFF),
      );

      const response = await request(
        buildRoleApp(UserRole.ADMIN, UserRole.PHARMACY_STAFF),
      )
        .get("/protected")
        .set("Authorization", `Bearer ${authToken(UserRole.CUSTOMER)}`);

      expect(response.status).toBe(200);
      expect(response.body.role).toBe(UserRole.PHARMACY_STAFF);
    });

    it("does not treat ADMIN as an implicit bypass", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authenticatedUser(UserRole.ADMIN));

      const response = await request(buildRoleApp(UserRole.PHARMACY_STAFF))
        .get("/protected")
        .set("Authorization", `Bearer ${authToken(UserRole.ADMIN)}`);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
    });

    it("denies when authorizeRoles is configured with zero roles", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authenticatedUser(UserRole.ADMIN));

      const response = await request(buildRoleApp())
        .get("/protected")
        .set("Authorization", `Bearer ${authToken(UserRole.ADMIN)}`);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
    });
  });

  describe("pharmacy membership contract", () => {
    it("requires active membership scoped to userId and pharmacyId", async () => {
      prismaMock.pharmacyStaff.findFirst.mockResolvedValue({
        id: membershipId,
        userId,
        pharmacyId,
        role: PharmacyStaffRole.PHARMACIST,
      });

      const membership = await getActivePharmacyMembership(userId, pharmacyId);

      expect(membership).toEqual({
        id: membershipId,
        userId,
        pharmacyId,
        role: PharmacyStaffRole.PHARMACIST,
      });
      expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledWith({
        where: { userId, pharmacyId, isActive: true },
        select: { id: true, userId: true, pharmacyId: true, role: true },
      });
    });

    it("does not let global pharmacy staff role replace pharmacy membership", async () => {
      prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);

      await expect(
        getActivePharmacyMembership(userId, otherPharmacyId),
      ).resolves.toBeNull();
      expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, pharmacyId: otherPharmacyId, isActive: true },
        }),
      );
    });

    it("does not return inactive or another user's membership", async () => {
      prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);

      await expect(getActivePharmacyMembership(userId, pharmacyId)).resolves.toBeNull();
      await expect(
        getActivePharmacyMembership(otherUserId, pharmacyId),
      ).resolves.toBeNull();
      expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { userId: otherUserId, pharmacyId, isActive: true },
        }),
      );
    });
  });

  describe("profile contract", () => {
    it("gets a safe current DB profile and keeps /auth/me available", async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce(authenticatedUser(UserRole.ADMIN))
        .mockResolvedValueOnce({
          ...baseUser,
          role: UserRole.ADMIN,
          passwordHash: "must-not-return",
        })
        .mockResolvedValueOnce(authenticatedUser())
        .mockResolvedValueOnce(baseUser);

      const profile = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken(UserRole.CUSTOMER)}`);

      expect(profile.status).toBe(200);
      expect(profile.body.user.role).toBe(UserRole.ADMIN);
      expect(profile.body.user.passwordHash).toBeUndefined();

      const authMe = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${authToken()}`);

      expect(authMe.status).toBe(200);
      expect(authMe.body.user.passwordHash).toBeUndefined();
    });

    it("patches allowed profile fields and translates duplicate conflicts", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(authenticatedUser());
      prismaMock.user.update.mockResolvedValueOnce({
        ...baseUser,
        name: "Updated Name",
        email: "new@example.com",
        phone: "9876543210",
      });

      const updated = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({
          name: " Updated Name ",
          email: " NEW@EXAMPLE.COM ",
          phone: "9876543210",
        });

      expect(updated.status).toBe(200);
      expect(updated.body.user.email).toBe("new@example.com");
      expect(prismaMock.user.update.mock.calls[0]?.[0].data).toEqual({
        name: "Updated Name",
        email: "new@example.com",
        phone: "9876543210",
      });

      prismaMock.user.findUnique.mockResolvedValueOnce(authenticatedUser());
      prismaMock.user.update.mockRejectedValueOnce(uniqueConstraintError("email"));

      const duplicateEmail = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ email: "used@example.com" });

      expect(duplicateEmail.status).toBe(409);
      expect(duplicateEmail.body.code).toBe("EMAIL_ALREADY_EXISTS");

      prismaMock.user.findUnique.mockResolvedValueOnce(authenticatedUser());
      prismaMock.user.update.mockRejectedValueOnce(uniqueConstraintError("phone"));

      const duplicatePhone = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ phone: "9876543210" });

      expect(duplicatePhone.status).toBe(409);
      expect(duplicatePhone.body.code).toBe("PHONE_ALREADY_EXISTS");
    });

    it("rejects profile mass-assignment fields and empty updates", async () => {
      const forbiddenBodies = [
        {},
        { role: UserRole.ADMIN },
        { isActive: false },
        { password: "new-password" },
        { passwordHash: "hash" },
        { id: otherUserId },
        { createdAt: createdAt.toISOString() },
      ];

      for (const body of forbiddenBodies) {
        prismaMock.user.findUnique.mockResolvedValueOnce(authenticatedUser());

        const response = await request(app)
          .patch("/api/v1/users/me")
          .set("Authorization", `Bearer ${authToken()}`)
          .send(body);

        expect(response.status).toBe(400);
        expect(response.body.code).toBe("VALIDATION_ERROR");
      }

      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });

  describe("saved address contract", () => {
    it("lists and creates only the authenticated user's addresses", async () => {
      prismaMock.address.findMany.mockResolvedValue([baseAddress]);

      const list = await request(app)
        .get("/api/v1/users/me/addresses")
        .set("Authorization", authenticatedHeader());

      expect(list.status).toBe(200);
      expect(list.body.addresses[0].userId).toBeUndefined();
      expect(prismaMock.address.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId } }),
      );

      prismaMock.address.count.mockResolvedValue(0);
      prismaMock.address.create.mockResolvedValue({
        ...baseAddress,
        isDefault: true,
      });

      const created = await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticatedHeader())
        .send({
          label: "Home",
          addressLine1: "123 Main Road",
          city: "Bengaluru",
          state: "Karnataka",
          postalCode: "560001",
        });

      expect(created.status).toBe(201);
      expect(created.body.address.isDefault).toBe(true);
      expect(prismaMock.address.create.mock.calls[0]?.[0].data.userId).toBe(
        userId,
      );
    });

    it("updates and deletes owned addresses without addressId-only authorization", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: addressId });
      prismaMock.address.update.mockResolvedValue({
        ...baseAddress,
        label: "Work",
      });

      const updated = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticatedHeader())
        .send({ label: "Work" });

      expect(updated.status).toBe(200);
      expect(prismaMock.address.findFirst).toHaveBeenCalledWith({
        where: { id: addressId, userId },
        select: { id: true },
      });
      expect(prismaMock.address.update.mock.calls[0]?.[0].data).toEqual({
        label: "Work",
      });

      prismaMock.address.deleteMany.mockResolvedValue({ count: 1 });

      const deleted = await request(app)
        .delete(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticatedHeader());

      expect(deleted.status).toBe(204);
      expect(prismaMock.address.deleteMany).toHaveBeenCalledWith({
        where: { id: addressId, userId },
      });
    });

    it("uses indistinguishable 404s for foreign and nonexistent addresses", async () => {
      prismaMock.address.findFirst.mockResolvedValue(null);

      const foreign = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticatedHeader())
        .send({ label: "Work" });

      prismaMock.address.deleteMany.mockResolvedValue({ count: 0 });

      const missing = await request(app)
        .delete(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticatedHeader());

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(foreign.body).toEqual({
        error: "Address not found.",
        code: "ADDRESS_NOT_FOUND",
      });
      expect(missing.body).toEqual(foreign.body);
    });

    it("validates address params and rejects client-owned identity fields", async () => {
      const malformed = await request(app)
        .patch("/api/v1/users/me/addresses/not-a-uuid")
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ label: "Work" });

      expect(malformed.status).toBe(400);
      expect(malformed.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.address.findFirst).not.toHaveBeenCalled();

      const forbidden = await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticatedHeader())
        .send({
          label: "Home",
          addressLine1: "123 Main Road",
          city: "Bengaluru",
          state: "Karnataka",
          postalCode: "560001",
          userId: otherUserId,
        });

      expect(forbidden.status).toBe(400);
      expect(forbidden.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.address.create).not.toHaveBeenCalled();
    });

    it("keeps default switching transaction-backed and scoped to the current user", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: addressId });
      prismaMock.address.update.mockResolvedValue({
        ...baseAddress,
        isDefault: true,
      });

      const setDefault = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticatedHeader())
        .send({ isDefault: true });

      expect(setDefault.status).toBe(200);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.address.updateMany).toHaveBeenCalledWith({
        where: { userId, id: { not: addressId } },
        data: { isDefault: false },
      });

      prismaMock.address.findFirst.mockResolvedValue({ id: addressId });
      prismaMock.address.update.mockResolvedValue({
        ...baseAddress,
        isDefault: false,
      });

      const unsetDefault = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticatedHeader())
        .send({ isDefault: false });

      expect(unsetDefault.status).toBe(200);
      expect(prismaMock.address.updateMany).toHaveBeenCalledTimes(1);

      prismaMock.address.deleteMany.mockResolvedValue({ count: 1 });

      const deleteDefault = await request(app)
        .delete(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticatedHeader());

      expect(deleteDefault.status).toBe(204);
      expect(prismaMock.address.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("validation and error contracts", () => {
    it("coerces query-string values and exposes parsed values through req.query", async () => {
      const response = await request(buildValidationApp()).get("/query?page=7");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ page: 7, valueType: "number" });
    });

    it("returns VALIDATION_ERROR when query validation fails", async () => {
      const response = await request(buildValidationApp()).get("/query?page=0");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "Invalid request body.",
        code: "VALIDATION_ERROR",
      });
    });

    it("preserves parsed body values for downstream handlers", async () => {
      const response = await request(buildValidationApp())
        .post("/body")
        .send({ name: " Validated Body " });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ name: "Validated Body" });
    });

    it("preserves validated params for downstream handlers", async () => {
      const itemId = "55555555-5555-4555-8555-555555555555";
      const response = await request(buildValidationApp()).get(
        `/params/${itemId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ itemId });
    });

    it("preserves shared validation, parser, payload, route, and security-header behavior", async () => {
      const health = await request(app).get("/api/v1/health");

      expect(health.status).toBe(200);
      expect(health.headers["x-content-type-options"]).toBe("nosniff");

      const validation = await request(app).post("/api/v1/auth/login").send({});

      expect(validation.status).toBe(400);
      expect(validation.body.code).toBe("VALIDATION_ERROR");

      const malformedJson = await request(app)
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/json")
        .send("{bad-json");

      expect(malformedJson.status).toBe(400);
      expect(malformedJson.body.code).toBe("MALFORMED_JSON");
      expect(malformedJson.text).not.toContain("<html");

      const tooLarge = await request(app)
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ data: "x".repeat(110_000) }));

      expect(tooLarge.status).toBe(413);
      expect(tooLarge.body.code).toBe("PAYLOAD_TOO_LARGE");

      const missingRoute = await request(app).get("/api/v1/not-a-route");

      expect(missingRoute.status).toBe(404);
      expect(missingRoute.body.code).toBe("ROUTE_NOT_FOUND");
    });
  });
});
