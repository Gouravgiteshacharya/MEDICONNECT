import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { UserRole } from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
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
    findUnique: Mock;
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
const otherAddressId = "33333333-3333-4333-8333-333333333333";
const createdAt = new Date("2026-03-04T05:06:07.000Z");
const updatedAt = new Date("2026-04-05T06:07:08.000Z");

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

const validAddressInput = {
  label: "Home",
  addressLine1: "123 Main Road",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
};

function authUser() {
  return {
    id: userId,
    role: UserRole.CUSTOMER,
    isActive: true,
  };
}

function authToken() {
  return signAuthToken({
    userId,
    role: UserRole.CUSTOMER,
  });
}

function authenticateRequest() {
  prismaMock.user.findUnique.mockResolvedValueOnce(authUser());

  return `Bearer ${authToken()}`;
}

function expectAddressBody(body: unknown, overrides = {}) {
  expect(body).toEqual({
    address: {
      id: addressId,
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
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      ...overrides,
    },
  });
}

function expectAddressNotFound(body: unknown) {
  expect(body).toEqual({
    error: "Address not found.",
    code: "ADDRESS_NOT_FOUND",
  });
}

describe("saved address API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prisma));
  });

  describe("GET /api/v1/users/me/addresses", () => {
    it("rejects unauthenticated requests", async () => {
      const response = await request(app).get("/api/v1/users/me/addresses");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: "Authentication required.",
        code: "AUTH_REQUIRED",
      });
      expect(prismaMock.address.findMany).not.toHaveBeenCalled();
    });

    it("scopes the list query to the authenticated userId", async () => {
      prismaMock.address.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest());

      expect(response.status).toBe(200);
      expect(prismaMock.address.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
        }),
      );
    });

    it("returns only intended safe address fields", async () => {
      prismaMock.address.findMany.mockResolvedValue([
        {
          ...baseAddress,
          secretInternalNote: "do-not-return",
        },
      ]);

      const response = await request(app)
        .get("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest());

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        addresses: [
          {
            id: addressId,
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
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
          },
        ],
      });
      expect(response.body.addresses[0].userId).toBeUndefined();
      expect(response.body.addresses[0].secretInternalNote).toBeUndefined();
    });

    it("requests deterministic ordering from Prisma", async () => {
      prismaMock.address.findMany.mockResolvedValue([]);

      await request(app)
        .get("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest());

      expect(prismaMock.address.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { isDefault: "desc" },
            { updatedAt: "desc" },
            { createdAt: "desc" },
            { id: "asc" },
          ],
        }),
      );
    });
  });

  describe("POST /api/v1/users/me/addresses", () => {
    it("creates an address", async () => {
      prismaMock.address.count.mockResolvedValue(1);
      prismaMock.address.create.mockResolvedValue(baseAddress);

      const response = await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest())
        .send(validAddressInput);

      expect(response.status).toBe(201);
      expectAddressBody(response.body);
    });

    it("injects the authenticated userId server-side", async () => {
      prismaMock.address.count.mockResolvedValue(1);
      prismaMock.address.create.mockResolvedValue(baseAddress);

      await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest())
        .send(validAddressInput);

      expect(prismaMock.address.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
          }),
        }),
      );
    });

    it("rejects client-supplied userId", async () => {
      const response = await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest())
        .send({
          ...validAddressInput,
          userId: "99999999-9999-4999-8999-999999999999",
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.address.create).not.toHaveBeenCalled();
    });

    it("makes the first address default when isDefault is omitted", async () => {
      prismaMock.address.count.mockResolvedValue(0);
      prismaMock.address.create.mockResolvedValue({
        ...baseAddress,
        isDefault: true,
      });

      const response = await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest())
        .send(validAddressInput);

      expect(response.status).toBe(201);
      expectAddressBody(response.body, { isDefault: true });
      expect(prismaMock.address.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isDefault: true }),
        }),
      );
    });

    it("unsets previous defaults for the same user when creating a default address", async () => {
      prismaMock.address.count.mockResolvedValue(2);
      prismaMock.address.create.mockResolvedValue({
        ...baseAddress,
        isDefault: true,
      });

      const response = await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest())
        .send({
          ...validAddressInput,
          isDefault: true,
        });

      expect(response.status).toBe(201);
      expect(prismaMock.address.updateMany).toHaveBeenCalledWith({
        where: { userId },
        data: { isDefault: false },
      });
    });

    it("uses a transaction when creating a default address", async () => {
      prismaMock.address.count.mockResolvedValue(1);
      prismaMock.address.create.mockResolvedValue({
        ...baseAddress,
        isDefault: true,
      });

      await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest())
        .send({
          ...validAddressInput,
          isDefault: true,
        });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it("rejects unknown fields", async () => {
      const response = await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest())
        .send({
          ...validAddressInput,
          nickname: "not-allowed",
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.address.create).not.toHaveBeenCalled();
    });

    it("rejects invalid latitude", async () => {
      const response = await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest())
        .send({
          ...validAddressInput,
          latitude: 91,
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.address.create).not.toHaveBeenCalled();
    });

    it("rejects invalid longitude", async () => {
      const response = await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest())
        .send({
          ...validAddressInput,
          longitude: -181,
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.address.create).not.toHaveBeenCalled();
    });

    it("validates required create fields", async () => {
      const response = await request(app)
        .post("/api/v1/users/me/addresses")
        .set("Authorization", authenticateRequest())
        .send({
          label: "Home",
          addressLine1: "123 Main Road",
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.address.create).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /api/v1/users/me/addresses/:addressId", () => {
    it("updates an owned address", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: addressId });
      prismaMock.address.update.mockResolvedValue({
        ...baseAddress,
        label: "Work",
      });

      const response = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest())
        .send({ label: " Work " });

      expect(response.status).toBe(200);
      expectAddressBody(response.body, { label: "Work" });
      expect(prismaMock.address.findFirst).toHaveBeenCalledWith({
        where: { id: addressId, userId },
        select: { id: true },
      });
    });

    it("sends only allowed update fields to Prisma", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: addressId });
      prismaMock.address.update.mockResolvedValue({
        ...baseAddress,
        label: "Work",
        addressLine2: "Floor 2",
        landmark: null,
        latitude: 12.9716,
        longitude: 77.5946,
      });

      await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest())
        .send({
          label: "Work",
          addressLine2: "Floor 2",
          landmark: null,
          latitude: 12.9716,
          longitude: 77.5946,
        });

      const updateArgs = prismaMock.address.update.mock.calls[0]?.[0];

      expect(updateArgs.data).toEqual({
        label: "Work",
        addressLine2: "Floor 2",
        landmark: null,
        latitude: 12.9716,
        longitude: 77.5946,
      });
      expect(updateArgs.data.id).toBeUndefined();
      expect(updateArgs.data.userId).toBeUndefined();
      expect(updateArgs.data.createdAt).toBeUndefined();
      expect(updateArgs.data.updatedAt).toBeUndefined();
    });

    it("rejects empty PATCH bodies before Prisma update", async () => {
      const response = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest())
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.address.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.address.update).not.toHaveBeenCalled();
    });

    it("does not update a foreign-owned address", async () => {
      prismaMock.address.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .patch(`/api/v1/users/me/addresses/${otherAddressId}`)
        .set("Authorization", authenticateRequest())
        .send({ label: "Work" });

      expect(response.status).toBe(404);
      expectAddressNotFound(response.body);
      expect(prismaMock.address.update).not.toHaveBeenCalled();
    });

    it("returns ADDRESS_NOT_FOUND for nonexistent addresses", async () => {
      prismaMock.address.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest())
        .send({ label: "Work" });

      expect(response.status).toBe(404);
      expectAddressNotFound(response.body);
    });

    it("uses the same public error for foreign and nonexistent addresses", async () => {
      prismaMock.address.findFirst.mockResolvedValue(null);

      const foreignResponse = await request(app)
        .patch(`/api/v1/users/me/addresses/${otherAddressId}`)
        .set("Authorization", authenticateRequest())
        .send({ label: "Work" });

      prismaMock.address.findFirst.mockResolvedValue(null);

      const missingResponse = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest())
        .send({ label: "Work" });

      expect(foreignResponse.status).toBe(404);
      expect(missingResponse.status).toBe(404);
      expect(foreignResponse.body).toEqual(missingResponse.body);
    });

    it("setting an owned address as default unsets only the current user's other defaults", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: addressId });
      prismaMock.address.update.mockResolvedValue({
        ...baseAddress,
        isDefault: true,
      });

      const response = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest())
        .send({ isDefault: true });

      expect(response.status).toBe(200);
      expect(prismaMock.address.updateMany).toHaveBeenCalledWith({
        where: { userId, id: { not: addressId } },
        data: { isDefault: false },
      });
    });

    it("uses a transaction when switching the default address", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: addressId });
      prismaMock.address.update.mockResolvedValue({
        ...baseAddress,
        isDefault: true,
      });

      await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest())
        .send({ isDefault: true });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it("allows setting isDefault=false without promoting another address", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: addressId });
      prismaMock.address.update.mockResolvedValue({
        ...baseAddress,
        isDefault: false,
      });

      const response = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest())
        .send({ isDefault: false });

      expect(response.status).toBe(200);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.address.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.address.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isDefault: false },
        }),
      );
    });

    it("rejects id, userId, and timestamps before Prisma update", async () => {
      const forbiddenBodies = [
        { id: addressId },
        { userId },
        { createdAt: createdAt.toISOString() },
        { updatedAt: updatedAt.toISOString() },
      ];

      for (const body of forbiddenBodies) {
        const response = await request(app)
          .patch(`/api/v1/users/me/addresses/${addressId}`)
          .set("Authorization", authenticateRequest())
          .send(body);

        expect(response.status).toBe(400);
        expect(response.body.code).toBe("VALIDATION_ERROR");
      }

      expect(prismaMock.address.update).not.toHaveBeenCalled();
    });

    it("rejects invalid coordinates before Prisma update", async () => {
      const response = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest())
        .send({ longitude: 181 });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.address.update).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/v1/users/me/addresses/:addressId", () => {
    it("deletes an owned address", async () => {
      prismaMock.address.deleteMany.mockResolvedValue({ count: 1 });

      const response = await request(app)
        .delete(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest());

      expect(response.status).toBe(204);
      expect(response.text).toBe("");
    });

    it("does not delete a foreign-owned address", async () => {
      prismaMock.address.deleteMany.mockResolvedValue({ count: 0 });

      const response = await request(app)
        .delete(`/api/v1/users/me/addresses/${otherAddressId}`)
        .set("Authorization", authenticateRequest());

      expect(response.status).toBe(404);
      expectAddressNotFound(response.body);
    });

    it("returns ADDRESS_NOT_FOUND for nonexistent addresses", async () => {
      prismaMock.address.deleteMany.mockResolvedValue({ count: 0 });

      const response = await request(app)
        .delete(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest());

      expect(response.status).toBe(404);
      expectAddressNotFound(response.body);
    });

    it("scopes delete by ownership", async () => {
      prismaMock.address.deleteMany.mockResolvedValue({ count: 1 });

      await request(app)
        .delete(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest());

      expect(prismaMock.address.deleteMany).toHaveBeenCalledWith({
        where: { id: addressId, userId },
      });
    });

    it("deletes the default address without promoting another address", async () => {
      prismaMock.address.deleteMany.mockResolvedValue({ count: 1 });

      const response = await request(app)
        .delete(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest());

      expect(response.status).toBe(204);
      expect(prismaMock.address.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("security properties", () => {
    it("does not authorize update by addressId alone", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: addressId });
      prismaMock.address.update.mockResolvedValue(baseAddress);

      await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest())
        .send({ label: "Home" });

      expect(prismaMock.address.findFirst).toHaveBeenCalledWith({
        where: { id: addressId, userId },
        select: { id: true },
      });
    });

    it("does not authorize delete by addressId alone", async () => {
      prismaMock.address.deleteMany.mockResolvedValue({ count: 1 });

      await request(app)
        .delete(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest());

      expect(prismaMock.address.deleteMany).toHaveBeenCalledWith({
        where: { id: addressId, userId },
      });
    });

    it("never changes another user's default state", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: addressId });
      prismaMock.address.update.mockResolvedValue({
        ...baseAddress,
        isDefault: true,
      });

      await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set("Authorization", authenticateRequest())
        .send({ isDefault: true });

      const updateManyArgs = prismaMock.address.updateMany.mock.calls[0]?.[0];

      expect(updateManyArgs.where.userId).toBe(userId);
      expect(updateManyArgs.where.userId).not.toBeUndefined();
    });
  });
});
