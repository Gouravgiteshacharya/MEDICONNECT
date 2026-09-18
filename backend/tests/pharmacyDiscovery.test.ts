import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { PharmacyStaffRole, UserRole } from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    pharmacyStaff: { findMany: vi.fn() },
    pharmacy: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  pharmacyStaff: { findMany: Mock };
  pharmacy: { findFirst: Mock; findUnique: Mock };
};

const userId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const otherPharmacyId = "33333333-3333-4333-8333-333333333333";
const membership = {
  id: "44444444-4444-4444-8444-444444444444",
  userId,
  isActive: true,
  role: PharmacyStaffRole.PHARMACIST,
  pharmacy: { id: pharmacyId, name: "Neighborhood Pharmacy", licenseNumber: "private" },
};
const expectedMembership = {
  id: membership.id,
  role: membership.role,
  pharmacy: { id: pharmacyId, name: "Neighborhood Pharmacy" },
};

function authHeader(role: UserRole = UserRole.PHARMACY_STAFF) {
  prismaMock.user.findUnique.mockResolvedValue({ id: userId, role, isActive: true });
  return `Bearer ${signAuthToken({ userId, role })}`;
}

describe("GET /api/v1/pharmacies/me", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.pharmacyStaff.findMany.mockResolvedValue([]);
  });

  it("returns one active membership with only workspace discovery fields", async () => {
    prismaMock.pharmacyStaff.findMany.mockResolvedValue([membership]);
    const response = await request(app)
      .get("/api/v1/pharmacies/me")
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ memberships: [expectedMembership] });
    expect(prismaMock.pharmacyStaff.findMany).toHaveBeenCalledWith({
      where: { userId, isActive: true },
      select: {
        id: true,
        role: true,
        pharmacy: { select: { id: true, name: true } },
      },
      orderBy: { id: "asc" },
    });
  });

  it("returns multiple active memberships", async () => {
    const second = {
      ...membership,
      id: "55555555-5555-4555-8555-555555555555",
      role: PharmacyStaffRole.MANAGER,
      pharmacy: { id: otherPharmacyId, name: "Second Pharmacy" },
    };
    prismaMock.pharmacyStaff.findMany.mockResolvedValue([membership, second]);
    const response = await request(app)
      .get("/api/v1/pharmacies/me")
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      memberships: [expectedMembership, { id: second.id, role: second.role, pharmacy: second.pharmacy }],
    });
  });

  it("excludes inactive memberships and memberships belonging to other users", async () => {
    const rows = [
      membership,
      { ...membership, id: "inactive", isActive: false },
      { ...membership, id: "another-user", userId: "another-user" },
    ];
    prismaMock.pharmacyStaff.findMany.mockImplementation(async ({ where }) =>
      rows.filter((row) => row.userId === where.userId && row.isActive === where.isActive),
    );
    const response = await request(app)
      .get("/api/v1/pharmacies/me")
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ memberships: [expectedMembership] });
  });

  it("returns an empty list when there are no active memberships", async () => {
    const response = await request(app)
      .get("/api/v1/pharmacies/me")
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ memberships: [] });
  });

  it.each([UserRole.CUSTOMER, UserRole.DELIVERY_PARTNER, UserRole.ADMIN])(
    "denies %s before membership lookup",
    async (role) => {
      const response = await request(app)
        .get("/api/v1/pharmacies/me")
        .set("Authorization", authHeader(role));

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
      expect(prismaMock.pharmacyStaff.findMany).not.toHaveBeenCalled();
    },
  );

  it("requires authentication", async () => {
    const response = await request(app).get("/api/v1/pharmacies/me");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTH_REQUIRED");
    expect(prismaMock.pharmacyStaff.findMany).not.toHaveBeenCalled();
  });

  it("does not use client pharmacyId or userId to discover arbitrary pharmacies", async () => {
    prismaMock.pharmacyStaff.findMany.mockResolvedValue([membership]);
    const response = await request(app)
      .get("/api/v1/pharmacies/me")
      .query({ pharmacyId: otherPharmacyId, userId: "another-user" })
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ memberships: [expectedMembership] });
    expect(prismaMock.pharmacyStaff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId, isActive: true } }),
    );
    expect(prismaMock.pharmacy.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacy.findUnique).not.toHaveBeenCalled();
  });
});
