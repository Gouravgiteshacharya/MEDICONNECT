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
  MAX_PHARMACY_WORKFLOW_ATTEMPTS,
  updatePharmacyOrderPreparation,
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

function currentOrder(status: OrderStatus) {
  return {
    id: orderId,
    status,
  };
}

function orderResult(status: OrderStatus) {
  return {
    id: orderId,
    orderNumber: "MC-ORDER-1",
    pharmacyId,
    fulfillmentMethod: FulfillmentMethod.DELIVERY,
    status,
    medicineSubtotal: new Prisma.Decimal("20.00"),
    deliveryFee: new Prisma.Decimal("5.00"),
    totalAmount: new Prisma.Decimal("25.00"),
    confirmedAt: new Date("2026-08-31T12:00:00.000Z"),
    createdAt: new Date("2026-08-31T10:00:00.000Z"),
  };
}

function mockPreparationSuccess(
  role: PharmacyStaffRole,
  currentStatus: OrderStatus,
  resultStatus: OrderStatus,
) {
  membership(role);
  prismaMock.order.findFirst.mockResolvedValue(
    currentOrder(currentStatus),
  );
  prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.order.findUnique.mockResolvedValue(
    orderResult(resultStatus),
  );
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
  `/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/preparation`;

describe("pharmacy order preparation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.$transaction.mockImplementation(
      async (callback) => callback(prisma),
    );
  });

  it("rejects unauthenticated requests", async () => {
    const response = await request(app)
      .patch(path)
      .send({ status: "PREPARING" });

    expect(response.status).toBe(401);
  });

  it("rejects customer requests", async () => {
    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader(UserRole.CUSTOMER))
      .send({ status: "PREPARING" });

    expect(response.status).toBe(403);
  });

  it.each([
    PharmacyStaffRole.OWNER,
    PharmacyStaffRole.MANAGER,
    PharmacyStaffRole.PHARMACIST,
  ])("allows exact-pharmacy %s to update preparation", async (role) => {
    mockPreparationSuccess(
      role,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader())
      .send({ status: "PREPARING" });

    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe(
      OrderStatus.PREPARING,
    );
  });

  it("forbids STAFF", async () => {
    membership(PharmacyStaffRole.STAFF);

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader())
      .send({ status: "PREPARING" });

    expectError(response, 403, "FORBIDDEN");
    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
  });

  it("forbids missing membership", async () => {
    prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader())
      .send({ status: "PREPARING" });

    expectError(response, 403, "FORBIDDEN");
  });

  it.each([
    ["invalid pharmacy UUID", "bad", orderId, { status: "PREPARING" }],
    ["invalid order UUID", pharmacyId, "bad", { status: "PREPARING" }],
    ["invalid status", pharmacyId, orderId, { status: "CONFIRMED" }],
    [
      "unknown field",
      pharmacyId,
      orderId,
      { status: "PREPARING", note: "starting" },
    ],
  ])("rejects %s", async (_name, pharmacy, order, body) => {
    const response = await request(app)
      .patch(
        `/api/v1/pharmacies/${pharmacy}/orders/${order}/preparation`,
      )
      .set("Authorization", authHeader())
      .send(body);

    expectError(response, 400, "VALIDATION_ERROR");
  });

  it("hides a cross-pharmacy order", async () => {
    membership();
    prismaMock.order.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader())
      .send({ status: "PREPARING" });

    expectError(response, 404, "ORDER_NOT_FOUND");

    expect(prismaMock.order.findFirst).toHaveBeenCalledWith({
      where: {
        id: orderId,
        pharmacyId,
      },
      select: {
        id: true,
        status: true,
      },
    });
  });

  it("moves CONFIRMED to PREPARING", async () => {
    mockPreparationSuccess(
      PharmacyStaffRole.OWNER,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader())
      .send({ status: "PREPARING" });

    expect(response.status).toBe(200);

    expect(prismaMock.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: orderId,
        pharmacyId,
        status: OrderStatus.CONFIRMED,
      },
      data: {
        status: OrderStatus.PREPARING,
      },
    });

    expect(prismaMock.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("moves PREPARING to READY_FOR_PICKUP", async () => {
    mockPreparationSuccess(
      PharmacyStaffRole.MANAGER,
      OrderStatus.PREPARING,
      OrderStatus.READY_FOR_PICKUP,
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader())
      .send({ status: "READY_FOR_PICKUP" });

    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe(
      OrderStatus.READY_FOR_PICKUP,
    );

    expect(prismaMock.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: orderId,
        pharmacyId,
        status: OrderStatus.PREPARING,
      },
      data: {
        status: OrderStatus.READY_FOR_PICKUP,
      },
    });
  });

  it.each([
    [OrderStatus.CREATED, "PREPARING"],
    [OrderStatus.PRESCRIPTION_PENDING, "PREPARING"],
    [OrderStatus.PRESCRIPTION_APPROVED, "PREPARING"],
    [OrderStatus.CONFIRMED, "READY_FOR_PICKUP"],
    [OrderStatus.READY_FOR_PICKUP, "READY_FOR_PICKUP"],
    [OrderStatus.READY_FOR_PICKUP, "PREPARING"],
    [OrderStatus.RIDER_ASSIGNED, "PREPARING"],
    [OrderStatus.DELIVERED, "PREPARING"],
    [OrderStatus.CANCELLED, "PREPARING"],
    [OrderStatus.REJECTED_BY_PHARMACY, "PREPARING"],
  ] as const)(
    "rejects transition from %s to %s",
    async (currentStatus, requestedStatus) => {
      membership();
      prismaMock.order.findFirst.mockResolvedValue(
        currentOrder(currentStatus),
      );

      const response = await request(app)
        .patch(path)
        .set("Authorization", authHeader())
        .send({ status: requestedStatus });

      expectError(
        response,
        409,
        "ORDER_PREPARATION_NOT_ALLOWED",
      );

      expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
    },
  );

  it("prevents stale preparation update from overwriting a newer state", async () => {
    membership();
    prismaMock.order.findFirst.mockResolvedValue(
      currentOrder(OrderStatus.CONFIRMED),
    );
    prismaMock.order.updateMany.mockResolvedValue({ count: 0 });

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader())
      .send({ status: "PREPARING" });

    expectError(
      response,
      409,
      "ORDER_PREPARATION_NOT_ALLOWED",
    );

    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });

  it("retries exact P2034 and re-reads state", async () => {
    membership();

    prismaMock.order.findFirst
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce(
        currentOrder(OrderStatus.CONFIRMED),
      );

    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.order.findUnique.mockResolvedValue(
      orderResult(OrderStatus.PREPARING),
    );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader())
      .send({ status: "PREPARING" });

    expect(response.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(
      prismaMock.pharmacyStaff.findFirst,
    ).toHaveBeenCalledTimes(2);
    expect(prismaMock.order.findFirst).toHaveBeenCalledTimes(2);
  });

  it("stops when state changes during retry", async () => {
    membership();

    prismaMock.order.findFirst
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce(
        currentOrder(OrderStatus.PREPARING),
      );

    const response = await request(app)
      .patch(path)
      .set("Authorization", authHeader())
      .send({ status: "PREPARING" });

    expectError(
      response,
      409,
      "ORDER_PREPARATION_NOT_ALLOWED",
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
      .set("Authorization", authHeader())
      .send({ status: "PREPARING" });

    expectError(
      response,
      409,
      "ORDER_PREPARATION_CONFLICT",
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
      updatePharmacyOrderPreparation(
        userId,
        pharmacyId,
        orderId,
        { status: OrderStatus.PREPARING },
        prisma as never,
        membershipReader,
      ),
    ).rejects.toBe(failure);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});