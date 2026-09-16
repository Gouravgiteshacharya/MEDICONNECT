import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  FulfillmentMethod,
  OrderStatus,
  PharmacyStaffRole,
  Prisma,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import {
  completePharmacySelfPickup,
  MAX_PHARMACY_WORKFLOW_ATTEMPTS,
} from "../src/services/pharmacyWorkflow.service.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    pharmacyStaff: { findFirst: vi.fn() },
    order: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    prescription: {},
    $transaction: vi.fn(),
  },
}));

const { prisma } = await import("../src/lib/prisma.js");

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  pharmacyStaff: { findFirst: Mock };
  order: {
    findFirst: Mock;
    findUnique: Mock;
    updateMany: Mock;
  };
  $transaction: Mock;
};

const userId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const staffId = "33333333-3333-4333-8333-333333333333";
const orderId = "44444444-4444-4444-8444-444444444444";
const completedAt = new Date("2026-09-12T12:00:00.000Z");

function authHeader(role: UserRole = UserRole.PHARMACY_STAFF) {
  prismaMock.user.findUnique.mockResolvedValueOnce({
    id: userId,
    role,
    isActive: true,
  });

  return `Bearer ${signAuthToken({ userId, role })}`;
}

function membership(
  role: PharmacyStaffRole = PharmacyStaffRole.OWNER,
) {
  prismaMock.pharmacyStaff.findFirst.mockResolvedValue({
    id: staffId,
    userId,
    pharmacyId,
    role,
  });
}

function currentOrder(
  status: OrderStatus,
  fulfillmentMethod: FulfillmentMethod = FulfillmentMethod.SELF_PICKUP,
) {
  return {
    id: orderId,
    status,
    fulfillmentMethod,
  };
}

function completedOrderResult() {
  return {
    id: orderId,
    orderNumber: "MC-ORDER-1",
    pharmacyId,
    fulfillmentMethod: FulfillmentMethod.SELF_PICKUP,
    status: OrderStatus.PICKED_UP_BY_CUSTOMER,
    medicineSubtotal: new Prisma.Decimal("20.00"),
    deliveryFee: new Prisma.Decimal("0.00"),
    totalAmount: new Prisma.Decimal("20.00"),
    confirmedAt: new Date("2026-09-12T10:00:00.000Z"),
    completedAt,
    createdAt: new Date("2026-09-12T09:00:00.000Z"),
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

const path =
  `/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/pickup`;

describe("pharmacy self-pickup completion API", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.$transaction.mockImplementation(
      async (callback) => callback(prisma),
    );
  });

  it("rejects unauthenticated requests", async () => {
    const response = await request(app).patch(path);
    expect(response.status).toBe(401);
  });

  it("rejects non-pharmacy users", async () => {
    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader(UserRole.CUSTOMER));

    expect(response.status).toBe(403);
  });

  it.each([
    PharmacyStaffRole.OWNER,
    PharmacyStaffRole.MANAGER,
    PharmacyStaffRole.PHARMACIST,
  ])("allows exact-pharmacy %s to complete pickup", async (role) => {
    membership(role);

    prismaMock.order.findFirst.mockResolvedValue(
      currentOrder(OrderStatus.READY_FOR_PICKUP),
    );

    prismaMock.order.updateMany.mockResolvedValue({
      count: 1,
    });

    prismaMock.order.findUnique.mockResolvedValue(
      completedOrderResult(),
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe(
      OrderStatus.PICKED_UP_BY_CUSTOMER,
    );
    expect(response.body.order.completedAt).toBeTruthy();
  });

  it("forbids STAFF", async () => {
    membership(PharmacyStaffRole.STAFF);

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(response, 403, "FORBIDDEN");
    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
  });

  it("forbids missing membership", async () => {
    prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(response, 403, "FORBIDDEN");
  });

  it.each([
    ["invalid pharmacy UUID", "bad", orderId],
    ["invalid order UUID", pharmacyId, "bad"],
  ])("rejects %s", async (_name, pharmacy, order) => {
    const response = await request(app)
      .patch(
        `/api/v1/pharmacies/${pharmacy}/orders/${order}/pickup`,
      )
      .set("Authorization", authHeader());

    expectError(response, 400, "VALIDATION_ERROR");
  });

  it("hides a cross-pharmacy order", async () => {
    membership();

    prismaMock.order.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(response, 404, "ORDER_NOT_FOUND");

    expect(prismaMock.order.findFirst).toHaveBeenCalledWith({
      where: {
        id: orderId,
        pharmacyId,
      },
      select: {
        id: true,
        status: true,
        fulfillmentMethod: true,
      },
    });
  });

  it("completes READY_FOR_PICKUP self-pickup order", async () => {
    membership();

    prismaMock.order.findFirst.mockResolvedValue(
      currentOrder(OrderStatus.READY_FOR_PICKUP),
    );

    prismaMock.order.updateMany.mockResolvedValue({
      count: 1,
    });

    prismaMock.order.findUnique.mockResolvedValue(
      completedOrderResult(),
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);

    expect(prismaMock.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: orderId,
        pharmacyId,
        fulfillmentMethod: FulfillmentMethod.SELF_PICKUP,
        status: OrderStatus.READY_FOR_PICKUP,
      },
      data: {
        status: OrderStatus.PICKED_UP_BY_CUSTOMER,
        completedAt: expect.any(Date),
      },
    });

    expect(
      prismaMock.$transaction.mock.calls[0][1],
    ).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("rejects DELIVERY orders", async () => {
    membership();

    prismaMock.order.findFirst.mockResolvedValue(
      currentOrder(
        OrderStatus.READY_FOR_PICKUP,
        FulfillmentMethod.DELIVERY,
      ),
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(
      response,
      409,
      "ORDER_PICKUP_NOT_ALLOWED",
    );

    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    OrderStatus.CREATED,
    OrderStatus.PRESCRIPTION_PENDING,
    OrderStatus.PRESCRIPTION_APPROVED,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.PICKED_UP_BY_CUSTOMER,
    OrderStatus.CANCELLED,
    OrderStatus.REJECTED_BY_PHARMACY,
    OrderStatus.DELIVERED,
  ])("rejects self-pickup completion from %s", async (status) => {
    membership();

    prismaMock.order.findFirst.mockResolvedValue(
      currentOrder(status),
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(
      response,
      409,
      "ORDER_PICKUP_NOT_ALLOWED",
    );

    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("prevents stale pickup completion from overwriting newer state", async () => {
    membership();

    prismaMock.order.findFirst.mockResolvedValue(
      currentOrder(OrderStatus.READY_FOR_PICKUP),
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
      "ORDER_PICKUP_NOT_ALLOWED",
    );

    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });

  it("retries exact P2034 and re-reads state", async () => {
    membership();

    prismaMock.order.findFirst
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce(
        currentOrder(OrderStatus.READY_FOR_PICKUP),
      );

    prismaMock.order.updateMany.mockResolvedValue({
      count: 1,
    });

    prismaMock.order.findUnique.mockResolvedValue(
      completedOrderResult(),
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(
      prismaMock.pharmacyStaff.findFirst,
    ).toHaveBeenCalledTimes(2);
  });

  it("stops when state changes during retry", async () => {
    membership();

    prismaMock.order.findFirst
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce(
        currentOrder(OrderStatus.PICKED_UP_BY_CUSTOMER),
      );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(
      response,
      409,
      "ORDER_PICKUP_NOT_ALLOWED",
    );

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("returns conflict after exactly three P2034 attempts", async () => {
    membership();

    prismaMock.order.findFirst.mockRejectedValue(
      knownError("P2034"),
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader());

    expectError(
      response,
      409,
      "ORDER_PICKUP_CONFLICT",
    );

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(
      MAX_PHARMACY_WORKFLOW_ATTEMPTS,
    );
  });

  it("does not retry unrelated errors", async () => {
    const failure = new Error("database unavailable");

    const membershipReader = vi.fn().mockResolvedValue({
      id: staffId,
      userId,
      pharmacyId,
      role: PharmacyStaffRole.OWNER,
    });

    prismaMock.$transaction.mockRejectedValue(failure);

    await expect(
      completePharmacySelfPickup(
        userId,
        pharmacyId,
        orderId,
        prisma as never,
        membershipReader,
        () => completedAt,
      ),
    ).rejects.toBe(failure);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});