import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { PharmacyStaffRole, UserRole } from "../generated/prisma/client.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    pharmacyStaff: {
      findFirst: vi.fn(),
    },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");
const { authenticate } = await import("../src/middleware/authenticate.js");
const { authorizeRoles } = await import("../src/middleware/authorizeRoles.js");
const { getActivePharmacyMembership } = await import(
  "../src/services/pharmacyMembership.service.js"
);

const prismaMock = prisma as unknown as {
  user: {
    findUnique: Mock;
  };
  pharmacyStaff: {
    findFirst: Mock;
  };
};

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const pharmacyId = "33333333-3333-4333-8333-333333333333";
const otherPharmacyId = "44444444-4444-4444-8444-444444444444";

function buildRoleApp(
  role: UserRole | undefined,
  ...allowedRoles: UserRole[]
) {
  const app = express();

  app.get(
    "/protected",
    (req, _res, next) => {
      if (role) {
        req.user = { id: userId, role };
      }
      next();
    },
    authorizeRoles(...allowedRoles),
    (_req, res) => {
      res.status(200).json({ ok: true });
    },
  );
  app.use(errorHandler);

  return app;
}

function buildAuthenticatedRoleApp(...allowedRoles: UserRole[]) {
  const app = express();

  app.get(
    "/protected",
    authenticate,
    authorizeRoles(...allowedRoles),
    (_req, res) => {
      res.status(200).json({ ok: true });
    },
  );
  app.use(errorHandler);

  return app;
}

function tokenFor(role: UserRole) {
  return signAuthToken({
    userId,
    role,
  });
}

describe("authorization middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows an authenticated ADMIN through ADMIN-only authorization", async () => {
    const response = await request(buildRoleApp(UserRole.ADMIN, UserRole.ADMIN)).get(
      "/protected",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("rejects an authenticated CUSTOMER from ADMIN-only authorization", async () => {
    const response = await request(
      buildRoleApp(UserRole.CUSTOMER, UserRole.ADMIN),
    ).get("/protected");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "You do not have permission to perform this action.",
      code: "FORBIDDEN",
    });
  });

  it("allows PHARMACY_STAFF where PHARMACY_STAFF is permitted", async () => {
    const response = await request(
      buildRoleApp(UserRole.PHARMACY_STAFF, UserRole.PHARMACY_STAFF),
    ).get("/protected");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("allows access when any one of multiple roles matches", async () => {
    const response = await request(
      buildRoleApp(
        UserRole.PHARMACY_STAFF,
        UserRole.ADMIN,
        UserRole.PHARMACY_STAFF,
      ),
    ).get("/protected");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("fails safely with AUTH_REQUIRED when no authenticated context exists", async () => {
    const response = await request(buildRoleApp(undefined, UserRole.ADMIN)).get(
      "/protected",
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
    });
  });

  it("denies access when no allowed roles are configured", async () => {
    const response = await request(buildRoleApp(UserRole.ADMIN)).get("/protected");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "You do not have permission to perform this action.",
      code: "FORBIDDEN",
    });
  });

  it("uses the current database role from authenticate over a stale token role", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: userId,
      role: UserRole.PHARMACY_STAFF,
      isActive: true,
    });

    const response = await request(
      buildAuthenticatedRoleApp(UserRole.PHARMACY_STAFF),
    )
      .get("/protected")
      .set("Authorization", `Bearer ${tokenFor(UserRole.CUSTOMER)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    });
  });

  it("rejects invalid JWT roles before global role authorization runs", async () => {
    const token = jwt.sign({ role: "SUPER_ADMIN" }, process.env.JWT_SECRET!, {
      algorithm: "HS256",
      subject: userId,
      expiresIn: 3600,
    });

    const response = await request(buildAuthenticatedRoleApp(UserRole.ADMIN))
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Invalid authentication token.",
      code: "INVALID_TOKEN",
    });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("pharmacy membership primitive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an active membership for the matching user and pharmacy", async () => {
    prismaMock.pharmacyStaff.findFirst.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      userId,
      pharmacyId,
      role: PharmacyStaffRole.PHARMACIST,
    });

    const membership = await getActivePharmacyMembership(userId, pharmacyId);

    expect(membership).toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      userId,
      pharmacyId,
      role: PharmacyStaffRole.PHARMACIST,
    });
    expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        pharmacyId,
        isActive: true,
      },
      select: {
        id: true,
        userId: true,
        pharmacyId: true,
        role: true,
      },
    });
  });

  it("does not treat inactive membership as active", async () => {
    prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);

    await expect(getActivePharmacyMembership(userId, pharmacyId)).resolves.toBeNull();
    expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
  });

  it("does not return membership for another pharmacy", async () => {
    prismaMock.pharmacyStaff.findFirst.mockImplementation(async ({ where }) =>
      where.pharmacyId === pharmacyId
        ? {
            id: "55555555-5555-4555-8555-555555555555",
            userId,
            pharmacyId,
            role: PharmacyStaffRole.MANAGER,
          }
        : null,
    );

    await expect(
      getActivePharmacyMembership(userId, otherPharmacyId),
    ).resolves.toBeNull();
    expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId,
          pharmacyId: otherPharmacyId,
          isActive: true,
        }),
      }),
    );
  });

  it("does not return membership for another user", async () => {
    prismaMock.pharmacyStaff.findFirst.mockImplementation(async ({ where }) =>
      where.userId === userId
        ? {
            id: "55555555-5555-4555-8555-555555555555",
            userId,
            pharmacyId,
            role: PharmacyStaffRole.OWNER,
          }
        : null,
    );

    await expect(
      getActivePharmacyMembership(otherUserId, pharmacyId),
    ).resolves.toBeNull();
    expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: otherUserId,
          pharmacyId,
          isActive: true,
        }),
      }),
    );
  });

  it("returns only the intended membership context", async () => {
    prismaMock.pharmacyStaff.findFirst.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      userId,
      pharmacyId,
      role: PharmacyStaffRole.STAFF,
      isActive: true,
      user: { id: userId },
      pharmacy: { id: pharmacyId },
    });

    const membership = await getActivePharmacyMembership(userId, pharmacyId);

    expect(membership).toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      userId,
      pharmacyId,
      role: PharmacyStaffRole.STAFF,
    });
    expect(Object.keys(membership ?? {})).toEqual([
      "id",
      "userId",
      "pharmacyId",
      "role",
    ]);
  });
});
