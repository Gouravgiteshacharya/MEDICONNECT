import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  InventoryManagementMode,
  PharmacyPartnerStatus,
  PharmacyStaffRole,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    pharmacy: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pharmacyStaff: { findFirst: vi.fn() },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  pharmacy: { findFirst: Mock; findUnique: Mock; update: Mock };
  pharmacyStaff: { findFirst: Mock };
};

const userId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const otherPharmacyId = "33333333-3333-4333-8333-333333333333";
const createdAt = new Date("2026-01-02T03:04:05.000Z");
const updatedAt = new Date("2026-02-03T04:05:06.000Z");

const publicPharmacy = {
  id: pharmacyId,
  name: "Neighborhood Pharmacy",
  description: "Independent local pharmacy",
  phone: "9876543210",
  email: "hello@pharmacy.example",
  addressLine1: "12 Market Road",
  addressLine2: null,
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
  latitude: 12.9716,
  longitude: 77.5946,
};

const operationalPharmacy = {
  ...publicPharmacy,
  licenseNumber: "KA-PHARM-123",
  isVerified: true,
  isActive: true,
  partnerStatus: PharmacyPartnerStatus.ACTIVE,
  inventoryManagementMode: InventoryManagementMode.SELF_MANAGED,
  createdAt,
  updatedAt,
};

function authHeader() {
  return `Bearer ${signAuthToken({ userId, role: UserRole.PHARMACY_STAFF })}`;
}

function mockAuthenticatedUser() {
  prismaMock.user.findUnique.mockResolvedValue({
    id: userId,
    role: UserRole.PHARMACY_STAFF,
    isActive: true,
  });
}

function mockMembership(
  role: PharmacyStaffRole = PharmacyStaffRole.PHARMACIST,
  memberPharmacyId = pharmacyId,
) {
  prismaMock.pharmacyStaff.findFirst.mockImplementation(async ({ where }) =>
    where.userId === userId && where.pharmacyId === memberPharmacyId
      ? {
          id: "44444444-4444-4444-8444-444444444444",
          userId,
          pharmacyId: memberPharmacyId,
          role,
        }
      : null,
  );
}

describe("pharmacy profile API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/pharmacies/:pharmacyId", () => {
    it("returns an eligible pharmacy with only public fields", async () => {
      prismaMock.pharmacy.findFirst.mockResolvedValue({
        ...publicPharmacy,
        licenseNumber: "must-not-leak",
        isVerified: true,
      });

      const response = await request(app).get(`/api/v1/pharmacies/${pharmacyId}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ pharmacy: publicPharmacy });
      expect(response.body.pharmacy.licenseNumber).toBeUndefined();
      expect(prismaMock.pharmacy.findFirst).toHaveBeenCalledWith({
        where: {
          id: pharmacyId,
          isActive: true,
          isVerified: true,
          partnerStatus: PharmacyPartnerStatus.ACTIVE,
        },
        select: expect.not.objectContaining({ licenseNumber: true }),
      });
    });

    it.each([
      ["inactive", { isActive: false }],
      ["unverified", { isVerified: false }],
      ["non-ACTIVE partner", { partnerStatus: PharmacyPartnerStatus.PENDING }],
      ["nonexistent", null],
    ])("does not expose an %s pharmacy", async (_label, _record) => {
      prismaMock.pharmacy.findFirst.mockResolvedValue(null);

      const response = await request(app).get(`/api/v1/pharmacies/${pharmacyId}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: "Pharmacy not found.",
        code: "PHARMACY_NOT_FOUND",
      });
    });
  });

  describe("GET /api/v1/pharmacies/:pharmacyId/profile", () => {
    it("rejects an unauthenticated request", async () => {
      const response = await request(app).get(
        `/api/v1/pharmacies/${pharmacyId}/profile`,
      );

      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTH_REQUIRED");
      expect(prismaMock.pharmacyStaff.findFirst).not.toHaveBeenCalled();
    });

    it("rejects an authenticated CUSTOMER before pharmacy membership resolution", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: userId,
        role: UserRole.CUSTOMER,
        isActive: true,
      });
      const token = signAuthToken({ userId, role: UserRole.CUSTOMER });

      const response = await request(app)
        .get(`/api/v1/pharmacies/${pharmacyId}/profile`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
      expect(prismaMock.pharmacyStaff.findFirst).not.toHaveBeenCalled();
    });

    it("rejects pharmacy staff from another pharmacy", async () => {
      mockAuthenticatedUser();
      mockMembership(PharmacyStaffRole.MANAGER, otherPharmacyId);

      const response = await request(app)
        .get(`/api/v1/pharmacies/${pharmacyId}/profile`)
        .set("Authorization", authHeader());

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
      expect(prismaMock.pharmacy.findUnique).not.toHaveBeenCalled();
    });

    it("rejects an inactive membership", async () => {
      mockAuthenticatedUser();
      prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/v1/pharmacies/${pharmacyId}/profile`)
        .set("Authorization", authHeader());

      expect(response.status).toBe(403);
      expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
    });

    it("allows an active member of the requested pharmacy", async () => {
      mockAuthenticatedUser();
      mockMembership();
      prismaMock.pharmacy.findUnique.mockResolvedValue(operationalPharmacy);

      const response = await request(app)
        .get(`/api/v1/pharmacies/${pharmacyId}/profile`)
        .set("Authorization", authHeader());

      expect(response.status).toBe(200);
      expect(response.body.pharmacy).toEqual({
        ...operationalPharmacy,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      });
    });
  });

  describe("PATCH /api/v1/pharmacies/:pharmacyId/profile", () => {
    async function patch(body: Record<string, unknown>, id = pharmacyId) {
      return request(app)
        .patch(`/api/v1/pharmacies/${id}/profile`)
        .set("Authorization", authHeader())
        .send(body);
    }

    it("rejects an unauthenticated request", async () => {
      const response = await request(app)
        .patch(`/api/v1/pharmacies/${pharmacyId}/profile`)
        .send({ name: "Updated Pharmacy" });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTH_REQUIRED");
    });

    it("rejects an inactive membership", async () => {
      mockAuthenticatedUser();
      prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);

      const response = await patch({ name: "Updated Pharmacy" });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
      expect(prismaMock.pharmacy.update).not.toHaveBeenCalled();
    });

    it.each([PharmacyStaffRole.STAFF, PharmacyStaffRole.PHARMACIST])(
      "rejects the %s role",
      async (role) => {
        mockAuthenticatedUser();
        mockMembership(role);

        const response = await patch({ name: "Updated Pharmacy" });

        expect(response.status).toBe(403);
        expect(prismaMock.pharmacy.update).not.toHaveBeenCalled();
      },
    );

    it.each([PharmacyStaffRole.MANAGER, PharmacyStaffRole.OWNER])(
      "allows the %s role to update allowed fields",
      async (role) => {
        mockAuthenticatedUser();
        mockMembership(role);
        prismaMock.pharmacy.update.mockResolvedValue({
          ...operationalPharmacy,
          name: "Updated Pharmacy",
          latitude: 13.1,
        });

        const response = await patch({
          name: " Updated Pharmacy ",
          latitude: 13.1,
        });

        expect(response.status).toBe(200);
        expect(prismaMock.pharmacy.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: pharmacyId },
            data: { name: "Updated Pharmacy", latitude: 13.1 },
          }),
        );
      },
    );

    it("rejects a member of another pharmacy", async () => {
      mockAuthenticatedUser();
      mockMembership(PharmacyStaffRole.OWNER, otherPharmacyId);

      const response = await patch({ name: "Updated Pharmacy" });

      expect(response.status).toBe(403);
      expect(prismaMock.pharmacy.update).not.toHaveBeenCalled();
    });

    it.each([
      ["isVerified", { isVerified: true }],
      ["isActive", { isActive: false }],
      ["partnerStatus", { partnerStatus: PharmacyPartnerStatus.ACTIVE }],
      ["licenseNumber", { licenseNumber: "NEW-LICENSE" }],
      ["inventoryManagementMode", { inventoryManagementMode: "MEDICONNECT_MANAGED" }],
      ["unknown field", { internalNote: "secret" }],
    ])("rejects forbidden field: %s", async (_label, body) => {
      mockAuthenticatedUser();

      const response = await patch(body);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.pharmacy.update).not.toHaveBeenCalled();
    });

    it("rejects a mixed allowed and forbidden update without a partial update", async () => {
      mockAuthenticatedUser();

      const response = await patch({
        name: "Updated Pharmacy",
        isVerified: true,
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.pharmacy.update).not.toHaveBeenCalled();
    });

    it("rejects a malformed pharmacy UUID", async () => {
      const response = await patch({ name: "Updated Pharmacy" }, "not-a-uuid");

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it.each([
      { latitude: -90.1 },
      { latitude: 90.1 },
      { longitude: -180.1 },
      { longitude: 180.1 },
    ])("rejects invalid coordinates: %j", async (body) => {
      mockAuthenticatedUser();

      const response = await patch(body);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.pharmacy.update).not.toHaveBeenCalled();
    });

    it("rejects an empty update", async () => {
      mockAuthenticatedUser();

      const response = await patch({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.pharmacy.update).not.toHaveBeenCalled();
    });

    it("sends only explicitly allowed fields to Prisma", async () => {
      mockAuthenticatedUser();
      mockMembership(PharmacyStaffRole.OWNER);
      prismaMock.pharmacy.update.mockResolvedValue({
        ...operationalPharmacy,
        description: null,
        email: null,
      });

      const response = await patch({
        description: null,
        email: null,
        addressLine2: null,
        latitude: null,
        longitude: null,
      });

      expect(response.status).toBe(200);
      const data = prismaMock.pharmacy.update.mock.calls[0]?.[0].data;
      expect(data).toEqual({
        description: null,
        email: null,
        addressLine2: null,
        latitude: null,
        longitude: null,
      });
      expect(data.isVerified).toBeUndefined();
      expect(data.isActive).toBeUndefined();
      expect(data.partnerStatus).toBeUndefined();
      expect(data.licenseNumber).toBeUndefined();
      expect(data.inventoryManagementMode).toBeUndefined();
    });
  });
});
