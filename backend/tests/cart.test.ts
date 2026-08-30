import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  CartStatus,
  FulfillmentMethod,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    cart: {
      findFirst: vi.fn(),
    },
    cartItem: {
      updateManyAndReturn: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  cart: { findFirst: Mock };
  cartItem: { updateManyAndReturn: Mock; deleteMany: Mock };
};

const customerId = "11111111-1111-4111-8111-111111111111";
const otherCustomerId = "22222222-2222-4222-8222-222222222222";
const cartId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const medicineId = "55555555-5555-4555-8555-555555555555";
const pharmacyId = "66666666-6666-4666-8666-666666666666";
const createdAt = new Date("2026-08-01T10:00:00.000Z");
const updatedAt = new Date("2026-08-02T10:00:00.000Z");

const medicine = {
  id: medicineId,
  name: "Test Medicine",
  brandName: "Test Brand",
  genericName: "Test Generic",
  manufacturer: "Test Manufacturer",
  requiresPrescription: false,
};

const cartItem = {
  id: itemId,
  medicineId,
  quantity: 2,
  createdAt,
  updatedAt,
  medicine,
};

const activeCart = {
  id: cartId,
  pharmacyId,
  deliveryAddressId: null,
  fulfillmentMethod: FulfillmentMethod.SELF_PICKUP,
  status: CartStatus.ACTIVE,
  createdAt,
  updatedAt,
  items: [cartItem],
};

function authToken(role: UserRole = UserRole.CUSTOMER) {
  return signAuthToken({ userId: customerId, role });
}

function authenticateAs(role: UserRole = UserRole.CUSTOMER) {
  prismaMock.user.findUnique.mockResolvedValueOnce({
    id: customerId,
    role,
    isActive: true,
  });

  return `Bearer ${authToken(role)}`;
}

function expectCartItemNotFound(response: { status: number; body: unknown }) {
  expect(response.status).toBe(404);
  expect(response.body).toEqual({
    error: "Cart item not found.",
    code: "CART_ITEM_NOT_FOUND",
  });
}

describe("customer cart API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/cart", () => {
    it("rejects unauthenticated requests", async () => {
      const response = await request(app).get("/api/v1/cart");

      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTH_REQUIRED");
      expect(prismaMock.cart.findFirst).not.toHaveBeenCalled();
    });

    it("rejects authenticated non-customer roles", async () => {
      const response = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF));

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
      expect(prismaMock.cart.findFirst).not.toHaveBeenCalled();
    });

    it("returns the authenticated customer's active cart and items", async () => {
      prismaMock.cart.findFirst.mockResolvedValue(activeCart);

      const response = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", authenticateAs());

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        cart: {
          ...activeCart,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
          items: [
            {
              ...cartItem,
              createdAt: createdAt.toISOString(),
              updatedAt: updatedAt.toISOString(),
            },
          ],
        },
      });
      expect(prismaMock.cart.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId, status: CartStatus.ACTIVE },
        }),
      );
    });

    it("returns a deterministic null response when no active cart exists", async () => {
      prismaMock.cart.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", authenticateAs());

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ cart: null });
    });

    it("never queries for or exposes another customer's cart", async () => {
      prismaMock.cart.findFirst.mockImplementation(async ({ where }) =>
        where.customerId === otherCustomerId ? activeCart : null,
      );

      const response = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", authenticateAs());

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ cart: null });
      expect(prismaMock.cart.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId, status: CartStatus.ACTIVE },
        }),
      );
    });
  });

  describe("PATCH /api/v1/cart/items/:itemId", () => {
    it("rejects unauthenticated requests", async () => {
      const response = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .send({ quantity: 3 });

      expect(response.status).toBe(401);
      expect(prismaMock.cartItem.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it("rejects authenticated non-customer roles", async () => {
      const response = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF))
        .send({ quantity: 3 });

      expect(response.status).toBe(403);
      expect(prismaMock.cartItem.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it("rejects invalid item UUIDs", async () => {
      const response = await request(app)
        .patch("/api/v1/cart/items/not-a-uuid")
        .set("Authorization", authenticateAs())
        .send({ quantity: 3 });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.cartItem.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it.each([
      ["missing quantity", {}],
      ["zero quantity", { quantity: 0 }],
      ["negative quantity", { quantity: -1 }],
      ["decimal quantity", { quantity: 1.5 }],
      ["string quantity", { quantity: "2" }],
      ["additional properties", { quantity: 2, medicineId }],
    ])("rejects %s", async (_name, body) => {
      const response = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs())
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.cartItem.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it("updates only quantity for an item in the customer's active cart", async () => {
      prismaMock.cartItem.updateManyAndReturn.mockResolvedValue([
        {
          ...cartItem,
          quantity: 4,
        },
      ]);

      const response = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs())
        .send({ quantity: 4 });

      expect(response.status).toBe(200);
      expect(response.body.item.quantity).toBe(4);
      expect(prismaMock.cartItem.updateManyAndReturn).toHaveBeenCalledWith({
        where: {
          id: itemId,
          cart: { customerId, status: CartStatus.ACTIVE },
        },
        data: { quantity: 4 },
        select: expect.any(Object),
      });
      expect(
        prismaMock.cartItem.updateManyAndReturn.mock.calls[0]?.[0].data,
      ).toEqual({ quantity: 4 });
    });

    it("fails safely for a nonexistent or inaccessible item", async () => {
      prismaMock.cartItem.updateManyAndReturn.mockResolvedValue([]);

      const response = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs())
        .send({ quantity: 3 });

      expectCartItemNotFound(response);
    });

    it("cannot change another customer's item", async () => {
      prismaMock.cartItem.updateManyAndReturn.mockImplementation(
        async ({ where }) =>
          where.cart.customerId === otherCustomerId ? [cartItem] : [],
      );

      const response = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs())
        .send({ quantity: 3 });

      expectCartItemNotFound(response);
    });

    it.each([CartStatus.CHECKED_OUT, CartStatus.ABANDONED])(
      "cannot change an item in a %s cart",
      async (status) => {
        prismaMock.cartItem.updateManyAndReturn.mockImplementation(
          async ({ where }) =>
            where.cart.status === status ? [cartItem] : [],
        );

        const response = await request(app)
          .patch(`/api/v1/cart/items/${itemId}`)
          .set("Authorization", authenticateAs())
          .send({ quantity: 3 });

        expectCartItemNotFound(response);
      },
    );
  });

  describe("DELETE /api/v1/cart/items/:itemId", () => {
    it("rejects unauthenticated requests", async () => {
      const response = await request(app).delete(
        `/api/v1/cart/items/${itemId}`,
      );

      expect(response.status).toBe(401);
      expect(prismaMock.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it("rejects authenticated non-customer roles", async () => {
      const response = await request(app)
        .delete(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF));

      expect(response.status).toBe(403);
      expect(prismaMock.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it("rejects invalid item UUIDs", async () => {
      const response = await request(app)
        .delete("/api/v1/cart/items/not-a-uuid")
        .set("Authorization", authenticateAs());

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it("deletes an item in the customer's active cart", async () => {
      prismaMock.cartItem.deleteMany.mockResolvedValue({ count: 1 });

      const response = await request(app)
        .delete(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs());

      expect(response.status).toBe(204);
      expect(prismaMock.cartItem.deleteMany).toHaveBeenCalledWith({
        where: {
          id: itemId,
          cart: { customerId, status: CartStatus.ACTIVE },
        },
      });
    });

    it("fails safely for an inaccessible or nonexistent item", async () => {
      prismaMock.cartItem.deleteMany.mockResolvedValue({ count: 0 });

      const response = await request(app)
        .delete(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs());

      expectCartItemNotFound(response);
    });

    it("cannot delete another customer's item", async () => {
      prismaMock.cartItem.deleteMany.mockImplementation(async ({ where }) => ({
        count: where.cart.customerId === otherCustomerId ? 1 : 0,
      }));

      const response = await request(app)
        .delete(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs());

      expectCartItemNotFound(response);
    });

    it.each([CartStatus.CHECKED_OUT, CartStatus.ABANDONED])(
      "cannot delete an item in a %s cart",
      async (status) => {
        prismaMock.cartItem.deleteMany.mockImplementation(async ({ where }) => ({
          count: where.cart.status === status ? 1 : 0,
        }));

        const response = await request(app)
          .delete(`/api/v1/cart/items/${itemId}`)
          .set("Authorization", authenticateAs());

        expectCartItemNotFound(response);
      },
    );
  });
});
