import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  FulfillmentMethod,
  OrderStatus,
  Prisma,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import {
  cancelCustomerOrder,
  MAX_CHECKOUT_ATTEMPTS,
} from "../src/services/order.service.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    order: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const { prisma } = await import("../src/lib/prisma.js");

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  order: {
    findFirst: Mock;
    updateMany: Mock;
  };
  $transaction: Mock;
};

const customerId = "11111111-1111-4111-8111-111111111111";
const otherCustomerId = "99999999-9999-4999-8999-999999999999";
const orderId = "22222222-2222-4222-8222-222222222222";
const pharmacyId = "33333333-3333-4333-8333-333333333333";
const cancelledAt = new Date("2026-09-12T10:00:00.000Z");

function authHeader(role: UserRole = UserRole.CUSTOMER) {
  prismaMock.user.findUnique.mockResolvedValueOnce({
    id: customerId,
    role,
    isActive: true,
  });

  return `Bearer ${signAuthToken({ userId: customerId, role })}`;
}

function currentOrder(status: OrderStatus) {
  return {
    id: orderId,
    status,
  };
}

function cancelledOrderResult() {
  return {
    id: orderId,
    orderNumber: "MC-ORDER-1",
    pharmacyId,
    fulfillmentMethod: FulfillmentMethod.DELIVERY,
    status: OrderStatus.CANCELLED,
    medicineSubtotal: new Prisma.Decimal("20.00"),
    deliveryFee: new Prisma.Decimal("5.00"),
    totalAmount: new Prisma.Decimal("25.00"),
    deliveryAddressId: null,
    deliveryAddressLabelSnapshot: null,
    deliveryAddressLine1Snapshot: null,
    deliveryAddressLine2Snapshot: null,
    deliveryLandmarkSnapshot: null,
    deliveryCitySnapshot: null,
    deliveryStateSnapshot: null,
    deliveryPostalCodeSnapshot: null,
    deliveryLatitudeSnapshot: null,
    deliveryLongitudeSnapshot: null,
    deliveryDistanceKm: null,
    quotedEtaMinutes: null,
    placedAt: new Date("2026-09-12T09:00:00.000Z"),
    confirmedAt: new Date("2026-09-12T09:10:00.000Z"),
    completedAt: null,
    cancelledAt,
    createdAt: new Date("2026-09-12T09:00:00.000Z"),
    updatedAt: cancelledAt,
    items: [],
    prescriptions: [],
  };
}

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: "test",
  });
}

function expectError(
  response: { status: number; body: unknown },
  status: number,
  code: string,
) {
  expect(response.status).toBe(status);
  expect(response.body).toEqual(
    expect.objectContaining({ code }),
  );
}

const path = `/api/v1/orders/${orderId}/cancel`;

describe("customer order cancellation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.$transaction.mockImplementation(
      async (callback) => callback(prisma),
    );
  });

  it("rejects unauthenticated requests", async () => {
    const response = await request(app)
      .patch(path);

    expect(response.status).toBe(401);
  });

  it("rejects non-customer requests", async () => {
    const response = await request(app)
      .patch(path)
      .set(
        "Authorization",
        authHeader(UserRole.PHARMACY_STAFF),
      );

    expect(response.status).toBe(403);
  });

  it("rejects invalid order UUID", async () => {
    const response = await request(app)
      .patch("/api/v1/orders/bad/cancel")
      .set("Authorization", authHeader());

    expectError(response, 400, "VALIDATION_ERROR");
  });

  it("hides another customer's order", async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(response, 404, "ORDER_NOT_FOUND");

    expect(prismaMock.order.findFirst).toHaveBeenCalledWith({
      where: {
        id: orderId,
        customerId,
      },
      select: {
        id: true,
        status: true,
      },
    });
  });

  it.each([
    OrderStatus.CREATED,
    OrderStatus.PRESCRIPTION_PENDING,
    OrderStatus.PRESCRIPTION_APPROVED,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
  ])("cancels from %s", async (status) => {
    prismaMock.order.findFirst
      .mockResolvedValueOnce(currentOrder(status))
      .mockResolvedValueOnce(cancelledOrderResult());

    prismaMock.order.updateMany.mockResolvedValue({
      count: 1,
    });

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe(
      OrderStatus.CANCELLED,
    );
    expect(response.body.order.cancelledAt).toBeTruthy();

    expect(prismaMock.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: orderId,
        customerId,
        status,
      },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: expect.any(Date),
      },
    });
  });

  it.each([
    OrderStatus.PRESCRIPTION_REJECTED,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.RIDER_ASSIGNED,
    OrderStatus.PICKED_UP,
    OrderStatus.PICKED_UP_BY_CUSTOMER,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
    OrderStatus.REJECTED_BY_PHARMACY,
  ])("rejects cancellation from %s", async (status) => {
    prismaMock.order.findFirst.mockResolvedValue(
      currentOrder(status),
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(
      response,
      409,
      "ORDER_CANCELLATION_NOT_ALLOWED",
    );

    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("prevents a stale cancellation from overwriting a newer state", async () => {
    prismaMock.order.findFirst.mockResolvedValue(
      currentOrder(OrderStatus.CONFIRMED),
    );

    prismaMock.order.updateMany.mockResolvedValue({
      count: 0,
    });

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(
      response,
      409,
      "ORDER_CANCELLATION_NOT_ALLOWED",
    );
  });

  it("uses a serializable transaction", async () => {
    prismaMock.order.findFirst
      .mockResolvedValueOnce(
        currentOrder(OrderStatus.CREATED),
      )
      .mockResolvedValueOnce(cancelledOrderResult());

    prismaMock.order.updateMany.mockResolvedValue({
      count: 1,
    });

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);

    expect(prismaMock.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("retries exact P2034 and re-reads state", async () => {
    prismaMock.order.findFirst
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce(
        currentOrder(OrderStatus.CONFIRMED),
      )
      .mockResolvedValueOnce(cancelledOrderResult());

    prismaMock.order.updateMany.mockResolvedValue({
      count: 1,
    });

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it("stops when state changes during retry", async () => {
    prismaMock.order.findFirst
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce(
        currentOrder(OrderStatus.READY_FOR_PICKUP),
      );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(
      response,
      409,
      "ORDER_CANCELLATION_NOT_ALLOWED",
    );

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("returns conflict after exactly three P2034 attempts", async () => {
    prismaMock.order.findFirst.mockRejectedValue(
      knownError("P2034"),
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(
      response,
      409,
      "ORDER_CANCELLATION_CONFLICT",
    );

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(
      MAX_CHECKOUT_ATTEMPTS,
    );
  });

  it("does not retry unrelated errors", async () => {
    const failure = new Error("database unavailable");

    prismaMock.$transaction.mockRejectedValue(failure);

    await expect(
      cancelCustomerOrder(
        customerId,
        orderId,
        prisma as never,
        () => cancelledAt,
      ),
    ).rejects.toBe(failure);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("never scopes cancellation to another customer", async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);

    await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expect(
      prismaMock.order.findFirst.mock.calls[0][0].where,
    ).not.toEqual(
      expect.objectContaining({
        customerId: otherCustomerId,
      }),
    );
  });
});