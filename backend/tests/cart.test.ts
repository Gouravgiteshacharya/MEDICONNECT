import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  CartStatus,
  FulfillmentMethod,
  InventoryStatus,
  Prisma,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import {
  addMedicineToCustomerCart,
  MAX_CART_TRANSACTION_ATTEMPTS,
} from "../src/services/cart.service.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    cart: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    cartItem: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateManyAndReturn: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/services/inventory.service.js", () => ({
  getOrderableInventorySnapshot: vi.fn(),
}));

const { prisma } = await import("../src/lib/prisma.js");
const { getOrderableInventorySnapshot } = await import(
  "../src/services/inventory.service.js"
);

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  cart: { findFirst: Mock; findMany: Mock; create: Mock; updateMany: Mock };
  cartItem: {
    findFirst: Mock;
    findUnique: Mock;
    create: Mock;
    updateManyAndReturn: Mock;
    deleteMany: Mock;
  };
  $transaction: Mock;
};
const snapshotMock = getOrderableInventorySnapshot as Mock;

const customerId = "11111111-1111-4111-8111-111111111111";
const otherCustomerId = "22222222-2222-4222-8222-222222222222";
const cartId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const medicineId = "55555555-5555-4555-8555-555555555555";
const pharmacyId = "66666666-6666-4666-8666-666666666666";
const otherPharmacyId = "77777777-7777-4777-8777-777777777777";
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
const cartContext = {
  id: cartId,
  pharmacyId,
  _count: { items: 1 },
};
const addInput = { pharmacyId, medicineId, quantity: 2 };

function snapshot(quantity = 10) {
  return {
    pharmacyId,
    medicineId,
    quantity,
    sellingPrice: "49.50",
    availability: InventoryStatus.AVAILABLE,
    lastUpdated: new Date(),
    freshness: "FRESH" as const,
    requiresPrescription: false,
  };
}

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

function expectError(
  response: { status: number; body: unknown },
  status: number,
  code: string,
) {
  expect(response.status).toBe(status);
  expect(response.body).toEqual(expect.objectContaining({ code }));
}

function mockPostSuccess(options?: {
  carts?: unknown[];
  existingItem?: { id: string; quantity: number } | null;
  resultQuantity?: number;
}) {
  snapshotMock.mockResolvedValue(snapshot());
  prismaMock.cart.findMany.mockResolvedValue(
    options?.carts ?? [cartContext],
  );
  prismaMock.cartItem.findUnique.mockResolvedValue(
    options?.existingItem ?? null,
  );
  const result = {
    ...cartItem,
    quantity: options?.resultQuantity ?? addInput.quantity,
  };
  prismaMock.cartItem.create.mockResolvedValue(result);
  prismaMock.cartItem.updateManyAndReturn.mockResolvedValue([result]);
}

function mockPatchSuccess(quantity = 4, available = 10) {
  prismaMock.cartItem.findFirst
    .mockResolvedValueOnce({ medicineId, cart: { pharmacyId } })
    .mockResolvedValueOnce({ id: itemId });
  snapshotMock.mockResolvedValue(snapshot(available));
  prismaMock.cartItem.updateManyAndReturn.mockResolvedValue([
    { ...cartItem, quantity },
  ]);
}

function knownError(code: string, target?: unknown) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: "test",
    ...(target === undefined ? {} : { meta: { target } }),
  });
}

describe("customer cart API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
  });

  describe("GET /api/v1/cart", () => {
    it("rejects unauthenticated and non-customer requests", async () => {
      expect((await request(app).get("/api/v1/cart")).status).toBe(401);
      const forbidden = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF));
      expect(forbidden.status).toBe(403);
      expect(prismaMock.cart.findFirst).not.toHaveBeenCalled();
    });

    it("returns only the customer's active cart", async () => {
      prismaMock.cart.findFirst.mockResolvedValue(activeCart);
      const response = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", authenticateAs());
      expect(response.status).toBe(200);
      expect(response.body.cart.id).toBe(cartId);
      expect(prismaMock.cart.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId, status: CartStatus.ACTIVE },
        }),
      );
    });

    it("returns null when no active cart exists and never exposes another customer", async () => {
      prismaMock.cart.findFirst.mockImplementation(async ({ where }) =>
        where.customerId === otherCustomerId ? activeCart : null,
      );
      const response = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", authenticateAs());
      expect(response.body).toEqual({ cart: null });
    });
  });

  describe("POST /api/v1/cart/items", () => {
    it("rejects unauthenticated and non-customer requests", async () => {
      expect(
        (await request(app).post("/api/v1/cart/items").send(addInput)).status,
      ).toBe(401);
      const forbidden = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF))
        .send(addInput);
      expect(forbidden.status).toBe(403);
      expect(snapshotMock).not.toHaveBeenCalled();
    });

    it.each([
      ["missing pharmacy", { medicineId, quantity: 1 }],
      ["invalid pharmacy", { ...addInput, pharmacyId: "bad" }],
      ["invalid medicine", { ...addInput, medicineId: "bad" }],
      ["missing quantity", { pharmacyId, medicineId }],
      ["zero quantity", { ...addInput, quantity: 0 }],
      ["negative quantity", { ...addInput, quantity: -1 }],
      ["decimal quantity", { ...addInput, quantity: 1.5 }],
      ["string quantity", { ...addInput, quantity: "2" }],
      ["extra property", { ...addInput, customerId }],
    ])("rejects %s", async (_name, body) => {
      const response = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(body);
      expectError(response, 400, "VALIDATION_ERROR");
      expect(snapshotMock).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("rejects a null snapshot without mutating the cart", async () => {
      snapshotMock.mockResolvedValue(null);
      const response = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(addInput);
      expectError(response, 409, "CART_ITEM_NOT_ORDERABLE");
      expect(snapshotMock).toHaveBeenCalledWith(pharmacyId, medicineId);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("rejects requested quantity above the snapshot", async () => {
      snapshotMock.mockResolvedValue(snapshot(1));
      const response = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(addInput);
      expectError(response, 409, "CART_QUANTITY_UNAVAILABLE");
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("creates an active pharmacy-bound cart and item when none exists", async () => {
      mockPostSuccess({ carts: [] });
      prismaMock.cart.create.mockResolvedValue({
        id: cartId,
        pharmacyId,
        _count: { items: 0 },
      });
      const response = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(addInput);
      expect(response.status).toBe(200);
      expect(prismaMock.cart.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { customerId, pharmacyId, status: CartStatus.ACTIVE },
        }),
      );
      expect(prismaMock.cartItem.create.mock.calls[0][0].data).toEqual({
        cartId,
        medicineId,
        quantity: 2,
      });
      expect(prismaMock.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: "Serializable",
      });
    });

    it("binds an empty null-pharmacy cart on the first successful add", async () => {
      mockPostSuccess({
        carts: [{ id: cartId, pharmacyId: null, _count: { items: 0 } }],
      });
      prismaMock.cart.updateMany.mockResolvedValue({ count: 1 });
      const response = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(addInput);
      expect(response.status).toBe(200);
      expect(prismaMock.cart.updateMany).toHaveBeenCalledWith({
        where: {
          id: cartId,
          customerId,
          status: CartStatus.ACTIVE,
          pharmacyId: null,
          items: { none: {} },
        },
        data: { pharmacyId },
      });
    });

    it("rejects a null-pharmacy cart that already has items", async () => {
      mockPostSuccess({
        carts: [{ id: cartId, pharmacyId: null, _count: { items: 1 } }],
      });
      const response = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(addInput);
      expectError(response, 409, "CART_STATE_CONFLICT");
      expect(prismaMock.cart.updateMany).not.toHaveBeenCalled();
    });

    it("allows the same pharmacy and rejects another without clearing the cart", async () => {
      mockPostSuccess();
      const allowed = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(addInput);
      expect(allowed.status).toBe(200);

      vi.clearAllMocks();
      prismaMock.$transaction.mockImplementation(async (callback) => callback(prisma));
      snapshotMock.mockResolvedValue({ ...snapshot(), pharmacyId: otherPharmacyId });
      prismaMock.cart.findMany.mockResolvedValue([cartContext]);
      const rejected = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send({ ...addInput, pharmacyId: otherPharmacyId });
      expectError(rejected, 409, "CART_PHARMACY_CONFLICT");
      expect(prismaMock.cartItem.create).not.toHaveBeenCalled();
      expect(prismaMock.cartItem.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it("increments a duplicate and validates the resulting total", async () => {
      mockPostSuccess({
        existingItem: { id: itemId, quantity: 3 },
        resultQuantity: 5,
      });
      const response = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(addInput);
      expect(response.body.item.quantity).toBe(5);
      expect(prismaMock.cartItem.updateManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({ data: { quantity: 5 } }),
      );
      expect(prismaMock.cartItem.create).not.toHaveBeenCalled();
    });

    it("rejects a duplicate resulting total above availability", async () => {
      mockPostSuccess({ existingItem: { id: itemId, quantity: 9 } });
      const response = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(addInput);
      expectError(response, 409, "CART_QUANTITY_UNAVAILABLE");
      expect(prismaMock.cartItem.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it("rejects multiple active carts", async () => {
      mockPostSuccess({ carts: [cartContext, { ...cartContext, id: itemId }] });
      const response = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(addInput);
      expectError(response, 409, "CART_STATE_CONFLICT");
    });
  });

  describe("PATCH /api/v1/cart/items/:itemId", () => {
    it("rejects unauthenticated, non-customer, invalid UUID, and invalid quantities", async () => {
      expect(
        (
          await request(app)
            .patch(`/api/v1/cart/items/${itemId}`)
            .send({ quantity: 3 })
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .patch(`/api/v1/cart/items/${itemId}`)
            .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF))
            .send({ quantity: 3 })
        ).status,
      ).toBe(403);
      for (const body of [{}, { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: "2" }, { quantity: 2, medicineId }]) {
        const response = await request(app)
          .patch(`/api/v1/cart/items/${itemId}`)
          .set("Authorization", authenticateAs())
          .send(body);
        expectError(response, 400, "VALIDATION_ERROR");
      }
      const invalidId = await request(app)
        .patch("/api/v1/cart/items/bad")
        .set("Authorization", authenticateAs())
        .send({ quantity: 1 });
      expectError(invalidId, 400, "VALIDATION_ERROR");
      expect(snapshotMock).not.toHaveBeenCalled();
    });

    it("revalidates inventory and updates only quantity", async () => {
      mockPatchSuccess(4);
      const response = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs())
        .send({ quantity: 4 });
      expect(response.status).toBe(200);
      expect(response.body.item.quantity).toBe(4);
      expect(snapshotMock).toHaveBeenCalledWith(pharmacyId, medicineId);
      expect(prismaMock.cartItem.updateManyAndReturn).toHaveBeenCalledWith({
        where: {
          id: itemId,
          medicineId,
          cart: { customerId, status: CartStatus.ACTIVE, pharmacyId },
        },
        data: { quantity: 4 },
        select: expect.any(Object),
      });
      expect(prismaMock.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: "Serializable",
      });
    });

    it("rejects a null snapshot without mutation", async () => {
      prismaMock.cartItem.findFirst.mockResolvedValueOnce({
        medicineId,
        cart: { pharmacyId },
      });
      snapshotMock.mockResolvedValue(null);
      const response = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs())
        .send({ quantity: 2 });
      expectError(response, 409, "CART_ITEM_NOT_ORDERABLE");
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.cartItem.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it("rejects above availability and allows equality", async () => {
      prismaMock.cartItem.findFirst.mockResolvedValueOnce({
        medicineId,
        cart: { pharmacyId },
      });
      snapshotMock.mockResolvedValue(snapshot(3));
      const rejected = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs())
        .send({ quantity: 4 });
      expectError(rejected, 409, "CART_QUANTITY_UNAVAILABLE");

      vi.clearAllMocks();
      prismaMock.$transaction.mockImplementation(async (callback) => callback(prisma));
      mockPatchSuccess(3, 3);
      const allowed = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs())
        .send({ quantity: 3 });
      expect(allowed.status).toBe(200);
    });

    it("fails safely for an active item under a null-pharmacy cart", async () => {
      prismaMock.cartItem.findFirst.mockResolvedValueOnce({
        medicineId,
        cart: { pharmacyId: null },
      });
      const response = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs())
        .send({ quantity: 2 });
      expectError(response, 409, "CART_STATE_CONFLICT");
      expect(snapshotMock).not.toHaveBeenCalled();
    });

    it.each(["nonexistent", "cross-customer", "checked-out", "abandoned"])(
      "preserves non-leaking not-found behavior for %s items",
      async () => {
        prismaMock.cartItem.findFirst.mockResolvedValueOnce(null);
        const response = await request(app)
          .patch(`/api/v1/cart/items/${itemId}`)
          .set("Authorization", authenticateAs())
          .send({ quantity: 2 });
        expectError(response, 404, "CART_ITEM_NOT_FOUND");
        expect(snapshotMock).not.toHaveBeenCalled();
      },
    );
  });

  describe("retry matching", () => {
    it("retries P2034 with a fresh snapshot and then succeeds", async () => {
      mockPostSuccess();
      prismaMock.$transaction
        .mockRejectedValueOnce(knownError("P2034"))
        .mockImplementationOnce(async (callback) => callback(prisma));
      const response = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(addInput);
      expect(response.status).toBe(200);
      expect(snapshotMock).toHaveBeenCalledTimes(2);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    });

    it("returns CART_UPDATE_CONFLICT after bounded P2034 retries", async () => {
      snapshotMock.mockResolvedValue(snapshot());
      prismaMock.$transaction.mockRejectedValue(knownError("P2034"));
      const response = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", authenticateAs())
        .send(addInput);
      expectError(response, 409, "CART_UPDATE_CONFLICT");
      expect(snapshotMock).toHaveBeenCalledTimes(MAX_CART_TRANSACTION_ATTEMPTS);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(
        MAX_CART_TRANSACTION_ATTEMPTS,
      );
    });

    it("retries only the exact CartItem compound P2002", async () => {
      mockPostSuccess();
      prismaMock.$transaction
        .mockRejectedValueOnce(
          knownError("P2002", ["cartId", "medicineId"]),
        )
        .mockImplementationOnce(async (callback) => callback(prisma));
      const result = await addMedicineToCustomerCart(customerId, addInput);
      expect(result).toEqual(expect.objectContaining({ medicineId }));
      expect(snapshotMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["unrelated P2002", knownError("P2002", ["customerId"])],
      [
        "reversed P2002 target",
        knownError("P2002", ["medicineId", "cartId"]),
      ],
      [
        "expanded P2002 target",
        knownError("P2002", ["cartId", "medicineId", "other"]),
      ],
      ["different Prisma error", knownError("P2025")],
      ["generic error", new Error("unexpected")],
    ])("does not retry %s", async (_name, failure) => {
      snapshotMock.mockResolvedValue(snapshot());
      prismaMock.$transaction.mockRejectedValue(failure);
      await expect(
        addMedicineToCustomerCart(customerId, addInput),
      ).rejects.toBe(failure);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(snapshotMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("DELETE /api/v1/cart/items/:itemId", () => {
    it("preserves authentication, validation, ownership, and active-cart scoping", async () => {
      expect(
        (await request(app).delete(`/api/v1/cart/items/${itemId}`)).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .delete(`/api/v1/cart/items/${itemId}`)
            .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF))
        ).status,
      ).toBe(403);
      const invalid = await request(app)
        .delete("/api/v1/cart/items/bad")
        .set("Authorization", authenticateAs());
      expectError(invalid, 400, "VALIDATION_ERROR");

      prismaMock.cartItem.deleteMany.mockResolvedValueOnce({ count: 1 });
      const deleted = await request(app)
        .delete(`/api/v1/cart/items/${itemId}`)
        .set("Authorization", authenticateAs());
      expect(deleted.status).toBe(204);
      expect(prismaMock.cartItem.deleteMany).toHaveBeenCalledWith({
        where: {
          id: itemId,
          cart: { customerId, status: CartStatus.ACTIVE },
        },
      });
    });

    it.each(["nonexistent", "cross-customer", "checked-out", "abandoned"])(
      "returns the same safe not-found response for %s items",
      async () => {
        prismaMock.cartItem.deleteMany.mockResolvedValueOnce({ count: 0 });
        const response = await request(app)
          .delete(`/api/v1/cart/items/${itemId}`)
          .set("Authorization", authenticateAs());
        expectError(response, 404, "CART_ITEM_NOT_FOUND");
      },
    );
  });
});
