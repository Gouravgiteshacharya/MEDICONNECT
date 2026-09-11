import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  CartStatus,
  FulfillmentMethod,
  InventoryStatus,
  OrderStatus,
  Prisma,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import {
  createCustomerOrder,
  MAX_CHECKOUT_ATTEMPTS,
} from "../src/services/order.service.js";
import { ApiError } from "../src/utils/ApiError.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    cart: { findMany: vi.fn(), updateMany: vi.fn() },
    address: { findFirst: vi.fn() },
    deliveryQuote: { findUnique: vi.fn(), updateMany: vi.fn() },
    order: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/services/inventory.service.js", () => ({
  getOrderableInventorySnapshot: vi.fn(),
}));

vi.mock("../src/services/medicine.service.js", () => ({
  getMedicineDetail: vi.fn(),
}));

const { prisma } = await import("../src/lib/prisma.js");
const { getOrderableInventorySnapshot } = await import(
  "../src/services/inventory.service.js"
);
const { getMedicineDetail } = await import("../src/services/medicine.service.js");

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  cart: { findMany: Mock; updateMany: Mock };
  address: { findFirst: Mock };
  deliveryQuote: { findUnique: Mock; updateMany: Mock };
  order: { create: Mock };
  $transaction: Mock;
};
const inventoryMock = getOrderableInventorySnapshot as Mock;
const medicineMock = getMedicineDetail as Mock;

const customerId = "11111111-1111-4111-8111-111111111111";
const otherCustomerId = "22222222-2222-4222-8222-222222222222";
const cartId = "33333333-3333-4333-8333-333333333333";
const pharmacyId = "44444444-4444-4444-8444-444444444444";
const medicineId = "55555555-5555-4555-8555-555555555555";
const cartItemId = "66666666-6666-4666-8666-666666666666";
const addressId = "77777777-7777-4777-8777-777777777777";
const quoteId = "88888888-8888-4888-8888-888888888888";
const orderId = "99999999-9999-4999-8999-999999999999";
const now = new Date("2026-08-31T10:00:00.000Z");

const selfPickupInput = {
  fulfillmentMethod: FulfillmentMethod.SELF_PICKUP,
} as const;
const deliveryInput = {
  fulfillmentMethod: FulfillmentMethod.DELIVERY,
  deliveryQuoteId: quoteId,
} as const;

function cart(overrides: Record<string, unknown> = {}) {
  return {
    id: cartId,
    pharmacyId,
    deliveryAddressId: null,
    fulfillmentMethod: FulfillmentMethod.SELF_PICKUP,
    items: [{ id: cartItemId, medicineId, quantity: 2 }],
    ...overrides,
  };
}

function inventory(overrides: Record<string, unknown> = {}) {
  return {
    pharmacyId,
    medicineId,
    quantity: 10,
    sellingPrice: "10.25",
    availability: InventoryStatus.AVAILABLE,
    lastUpdated: now,
    freshness: "FRESH",
    requiresPrescription: false,
    ...overrides,
  };
}

function medicine(overrides: Record<string, unknown> = {}) {
  return {
    id: medicineId,
    name: "Fresh Medicine Name",
    brandName: "Fresh Brand",
    genericName: "Fresh Generic",
    manufacturer: "Fresh Manufacturer",
    description: null,
    requiresPrescription: false,
    compositions: [],
    ...overrides,
  };
}

function address(overrides: Record<string, unknown> = {}) {
  return {
    id: addressId,
    label: "Home",
    addressLine1: "1 Main Road",
    addressLine2: "Floor 2",
    landmark: "Clock Tower",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

function quote(overrides: Record<string, unknown> = {}) {
  return {
    id: quoteId,
    customerId,
    pharmacyId,
    deliveryAddressId: addressId,
    orderId: null,
    finalDeliveryFee: new Prisma.Decimal("4.50"),
    distanceKm: 3.25,
    estimatedDurationMinutes: 25,
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  };
}

function authenticateAs(role: UserRole = UserRole.CUSTOMER) {
  prismaMock.user.findUnique.mockResolvedValueOnce({
    id: customerId,
    role,
    isActive: true,
  });
  return `Bearer ${signAuthToken({ userId: customerId, role })}`;
}

function knownError(code: string, target?: unknown) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: "test",
    ...(target === undefined ? {} : { meta: { target } }),
  });
}

function expectError(
  response: { status: number; body: unknown },
  status: number,
  code: string,
) {
  expect(response.status).toBe(status);
  expect(response.body).toEqual(expect.objectContaining({ code }));
}

function mockOrderCreate() {
  prismaMock.order.create.mockImplementation(async ({ data }) => ({
    id: orderId,
    orderNumber: data.orderNumber,
    customerId: data.customerId,
    pharmacyId: data.pharmacyId,
    deliveryAddressId: data.deliveryAddressId,
    fulfillmentMethod: data.fulfillmentMethod,
    status: data.status,
    deliveryAddressLabelSnapshot: data.deliveryAddressLabelSnapshot,
    deliveryAddressLine1Snapshot: data.deliveryAddressLine1Snapshot,
    deliveryAddressLine2Snapshot: data.deliveryAddressLine2Snapshot,
    deliveryLandmarkSnapshot: data.deliveryLandmarkSnapshot,
    deliveryCitySnapshot: data.deliveryCitySnapshot,
    deliveryStateSnapshot: data.deliveryStateSnapshot,
    deliveryPostalCodeSnapshot: data.deliveryPostalCodeSnapshot,
    deliveryLatitudeSnapshot: data.deliveryLatitudeSnapshot,
    deliveryLongitudeSnapshot: data.deliveryLongitudeSnapshot,
    medicineSubtotal: data.medicineSubtotal,
    deliveryFee: data.deliveryFee,
    totalAmount: data.totalAmount,
    deliveryDistanceKm: data.deliveryDistanceKm,
    quotedEtaMinutes: data.quotedEtaMinutes,
    placedAt: now,
    items: data.items.create.map((item: Record<string, unknown>, index: number) => ({
      id: `${index + 1}`,
      ...item,
    })),
  }));
}

function mockSelfPickupSuccess(overrides: Record<string, unknown> = {}) {
  prismaMock.cart.findMany.mockResolvedValue([cart(overrides)]);
  inventoryMock.mockResolvedValue(inventory());
  medicineMock.mockResolvedValue(medicine());
  mockOrderCreate();
  prismaMock.cart.updateMany.mockResolvedValue({ count: 1 });
}

function mockDeliverySuccess(quoteOverrides: Record<string, unknown> = {}) {
  prismaMock.cart.findMany.mockResolvedValue([
    cart({
      fulfillmentMethod: FulfillmentMethod.DELIVERY,
      deliveryAddressId: addressId,
    }),
  ]);
  inventoryMock.mockResolvedValue(inventory());
  medicineMock.mockResolvedValue(medicine());
  prismaMock.address.findFirst.mockResolvedValue(address());
  prismaMock.deliveryQuote.findUnique.mockResolvedValue(quote(quoteOverrides));
  prismaMock.deliveryQuote.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.cart.updateMany.mockResolvedValue({ count: 1 });
  mockOrderCreate();
}

describe("order creation API", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects unauthenticated and non-customer requests", async () => {
    expect((await request(app).post("/api/v1/orders").send(selfPickupInput)).status).toBe(401);
    const forbidden = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF))
      .send(selfPickupInput);
    expect(forbidden.status).toBe(403);
    expect(prismaMock.cart.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ["empty body", {}],
    ["unknown fulfillment", { fulfillmentMethod: "COURIER" }],
    ["delivery without quote", { fulfillmentMethod: "DELIVERY" }],
    ["delivery invalid quote", { fulfillmentMethod: "DELIVERY", deliveryQuoteId: "bad" }],
    ["delivery unknown field", { fulfillmentMethod: "DELIVERY", deliveryQuoteId: quoteId, totalAmount: 1 }],
    ["self pickup with quote", { fulfillmentMethod: "SELF_PICKUP", deliveryQuoteId: quoteId }],
    ["unknown field", { fulfillmentMethod: "SELF_PICKUP", totalAmount: 1 }],
  ])("strictly rejects %s", async (_name, body) => {
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(body);
    expectError(response, 400, "VALIDATION_ERROR");
    expect(prismaMock.cart.findMany).not.toHaveBeenCalled();
  });

  it("returns CART_NOT_FOUND with no active cart", async () => {
    prismaMock.cart.findMany.mockResolvedValue([]);
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expectError(response, 404, "CART_NOT_FOUND");
  });

  it("rejects multiple active carts", async () => {
    prismaMock.cart.findMany.mockResolvedValue([cart(), cart({ id: orderId })]);
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expectError(response, 409, "CART_STATE_CONFLICT");
  });

  it.each([
    ["missing pharmacy", { pharmacyId: null }],
    ["empty cart", { items: [] }],
    ["missing fulfillment", { fulfillmentMethod: null }],
    ["self pickup address corruption", { deliveryAddressId: addressId }],
  ])("rejects cart state: %s", async (_name, overrides) => {
    prismaMock.cart.findMany.mockResolvedValue([cart(overrides)]);
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expectError(response, 409, "CART_STATE_CONFLICT");
  });

  it("rejects a delivery cart without a delivery address", async () => {
    prismaMock.cart.findMany.mockResolvedValue([
      cart({
        fulfillmentMethod: FulfillmentMethod.DELIVERY,
        deliveryAddressId: null,
      }),
    ]);
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(deliveryInput);
    expectError(response, 409, "CART_STATE_CONFLICT");
  });

  it("rejects request/cart fulfillment mismatch", async () => {
    prismaMock.cart.findMany.mockResolvedValue([
      cart({ fulfillmentMethod: FulfillmentMethod.DELIVERY, deliveryAddressId: addressId }),
    ]);
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expectError(response, 409, "CART_FULFILLMENT_CONFLICT");
  });

  it("rejects an item that is no longer orderable", async () => {
    prismaMock.cart.findMany.mockResolvedValue([cart()]);
    inventoryMock.mockResolvedValue(null);
    medicineMock.mockResolvedValue(medicine());
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expectError(response, 409, "CHECKOUT_ITEM_NOT_ORDERABLE");
    expect(medicineMock).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("translates a medicine becoming inactive after the inventory read", async () => {
    prismaMock.cart.findMany.mockResolvedValue([cart()]);
    inventoryMock.mockResolvedValue(inventory());
    medicineMock.mockRejectedValue(
      new ApiError(404, "Medicine not found.", "MEDICINE_NOT_FOUND"),
    );
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expectError(response, 409, "CHECKOUT_ITEM_NOT_ORDERABLE");
    expect(inventoryMock).toHaveBeenCalledTimes(1);
    expect(medicineMock).toHaveBeenCalledWith(medicineId);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("does not translate unrelated medicine reader errors", async () => {
    const failure = new Error("medicine service unavailable");
    prismaMock.cart.findMany.mockResolvedValue([cart()]);
    inventoryMock.mockResolvedValue(inventory());
    medicineMock.mockRejectedValue(failure);

    await expect(
      createCustomerOrder(customerId, selfPickupInput),
    ).rejects.toBe(failure);
    expect(inventoryMock).toHaveBeenCalledTimes(1);
    expect(medicineMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects quantity above fresh availability", async () => {
    prismaMock.cart.findMany.mockResolvedValue([cart()]);
    inventoryMock.mockResolvedValue(inventory({ quantity: 1 }));
    medicineMock.mockResolvedValue(medicine());
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expectError(response, 409, "CHECKOUT_QUANTITY_UNAVAILABLE");
  });

  it("uses fresh prices and medicine snapshots with exact decimal math", async () => {
    mockSelfPickupSuccess();
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expect(response.status).toBe(201);
    expect(response.body.order).toEqual(
      expect.objectContaining({
        status: OrderStatus.CREATED,
        medicineSubtotal: "20.5",
        deliveryFee: "0",
        totalAmount: "20.5",
      }),
    );
    const data = prismaMock.order.create.mock.calls[0][0].data;
    expect(data.medicineSubtotal.toFixed(2)).toBe("20.50");
    expect(data.totalAmount.toFixed(2)).toBe("20.50");
    expect(data.items.create[0]).toEqual(
      expect.objectContaining({
        medicineNameSnapshot: "Fresh Medicine Name",
        brandNameSnapshot: "Fresh Brand",
        manufacturerSnapshot: "Fresh Manufacturer",
        unitPrice: expect.anything(),
        lineTotal: expect.anything(),
      }),
    );
    expect(data.items.create[0].unitPrice.toFixed(2)).toBe("10.25");
    expect(data.items.create[0].lineTotal.toFixed(2)).toBe("20.50");
  });

  it("starts prescription-required orders at PRESCRIPTION_PENDING", async () => {
    mockSelfPickupSuccess();
    inventoryMock.mockResolvedValue(inventory({ requiresPrescription: true }));
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expect(response.status).toBe(201);
    expect(response.body.order.status).toBe(OrderStatus.PRESCRIPTION_PENDING);
    expect(prismaMock.order.create.mock.calls[0][0].data.status).toBe(
      OrderStatus.PRESCRIPTION_PENDING,
    );
  });

  it("creates SELF_PICKUP without delivery data or quote linkage and checks out the cart", async () => {
    mockSelfPickupSuccess();
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expect(response.status).toBe(201);
    const data = prismaMock.order.create.mock.calls[0][0].data;
    expect(data).toEqual(
      expect.objectContaining({
        deliveryAddressId: null,
        deliveryFee: expect.anything(),
        deliveryDistanceKm: null,
        quotedEtaMinutes: null,
      }),
    );
    expect(data.deliveryFee.toFixed(2)).toBe("0.00");
    expect(prismaMock.deliveryQuote.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.deliveryQuote.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.cart.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: CartStatus.CHECKED_OUT } }),
    );
    expect(prismaMock.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("copies owned address and valid quote snapshots and attaches the quote", async () => {
    mockDeliverySuccess();
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(deliveryInput);
    expect(response.status).toBe(201);
    expect(prismaMock.address.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: addressId, userId: customerId } }),
    );
    const data = prismaMock.order.create.mock.calls[0][0].data;
    expect(data).toEqual(
      expect.objectContaining({
        deliveryAddressId: addressId,
        deliveryAddressLabelSnapshot: "Home",
        deliveryAddressLine1Snapshot: "1 Main Road",
        deliveryAddressLine2Snapshot: "Floor 2",
        deliveryLandmarkSnapshot: "Clock Tower",
        deliveryCitySnapshot: "Bengaluru",
        deliveryStateSnapshot: "Karnataka",
        deliveryPostalCodeSnapshot: "560001",
        deliveryLatitudeSnapshot: null,
        deliveryLongitudeSnapshot: null,
        deliveryDistanceKm: 3.25,
        quotedEtaMinutes: 25,
      }),
    );
    expect(data.deliveryFee.toFixed(2)).toBe("4.50");
    expect(data.totalAmount.toFixed(2)).toBe("25.00");
    expect(prismaMock.deliveryQuote.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { orderId } }),
    );
  });

  it("returns ADDRESS_NOT_FOUND for an inaccessible delivery address", async () => {
    mockDeliverySuccess();
    prismaMock.address.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(deliveryInput);
    expectError(response, 404, "ADDRESS_NOT_FOUND");
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it.each([
    ["customer", { customerId: otherCustomerId }],
    ["pharmacy", { pharmacyId: otherCustomerId }],
    ["address", { deliveryAddressId: otherCustomerId }],
  ])("rejects a quote with invalid %s", async (_name, overrides) => {
    mockDeliverySuccess(overrides);
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(deliveryInput);
    expectError(response, 409, "DELIVERY_QUOTE_INVALID");
  });

  it("rejects an already-used quote", async () => {
    mockDeliverySuccess({ orderId });
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(deliveryInput);
    expectError(response, 409, "DELIVERY_QUOTE_ALREADY_USED");
  });

  it("rejects an expired quote", async () => {
    mockDeliverySuccess({ expiresAt: new Date(0) });
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(deliveryInput);
    expectError(response, 409, "DELIVERY_QUOTE_EXPIRED");
  });

  it("translates a quote attachment race as already used", async () => {
    mockDeliverySuccess();
    prismaMock.deliveryQuote.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.deliveryQuote.findUnique
      .mockResolvedValueOnce(quote())
      .mockResolvedValueOnce(quote({ orderId }));
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(deliveryInput);
    expectError(response, 409, "DELIVERY_QUOTE_ALREADY_USED");
  });

  it("retries P2034 and refreshes inventory and medicine snapshots", async () => {
    mockSelfPickupSuccess();
    prismaMock.$transaction
      .mockRejectedValueOnce(knownError("P2034"))
      .mockImplementationOnce(async (callback) => callback(prisma));
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expect(response.status).toBe(201);
    expect(inventoryMock).toHaveBeenCalledTimes(2);
    expect(medicineMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it("retries only exact orderNumber P2002", async () => {
    mockSelfPickupSuccess();
    prismaMock.$transaction
      .mockRejectedValueOnce(knownError("P2002", ["orderNumber"]))
      .mockImplementationOnce(async (callback) => callback(prisma));
    const result = await createCustomerOrder(customerId, selfPickupInput);
    expect(result.id).toBe(orderId);
    expect(inventoryMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["unrelated", knownError("P2002", ["customerId"])],
    ["expanded", knownError("P2002", ["orderNumber", "id"])],
    ["generic", new Error("unexpected")],
  ])("does not retry %s errors", async (_name, failure) => {
    mockSelfPickupSuccess();
    prismaMock.$transaction.mockRejectedValue(failure);
    await expect(createCustomerOrder(customerId, selfPickupInput)).rejects.toBe(
      failure,
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(inventoryMock).toHaveBeenCalledTimes(1);
  });

  it("returns CHECKOUT_CONFLICT after bounded retry exhaustion", async () => {
    mockSelfPickupSuccess();
    prismaMock.$transaction.mockRejectedValue(knownError("P2034"));
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authenticateAs())
      .send(selfPickupInput);
    expectError(response, 409, "CHECKOUT_CONFLICT");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(MAX_CHECKOUT_ATTEMPTS);
    expect(inventoryMock).toHaveBeenCalledTimes(MAX_CHECKOUT_ATTEMPTS);
  });
});
