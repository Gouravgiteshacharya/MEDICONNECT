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
  decidePharmacyOrder,
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
  order: { findFirst: Mock; findUnique: Mock; updateMany: Mock };
  $transaction: Mock;
};

const userId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const staffId = "33333333-3333-4333-8333-333333333333";
const orderId = "44444444-4444-4444-8444-444444444444";
const decidedAt = new Date("2026-08-31T12:00:00.000Z");

function authHeader(role: UserRole = UserRole.PHARMACY_STAFF) {
  prismaMock.user.findUnique.mockResolvedValueOnce({ id: userId, role, isActive: true });
  return `Bearer ${signAuthToken({ userId, role })}`;
}

function membership(role: PharmacyStaffRole = PharmacyStaffRole.OWNER) {
  prismaMock.pharmacyStaff.findFirst.mockResolvedValue({
    id: staffId, userId, pharmacyId, role,
  });
}

function currentOrder(
  status: OrderStatus = OrderStatus.CREATED,
  requiresPrescription = false,
) {
  return {
    id: orderId,
    status,
    items: requiresPrescription ? [{ id: "55555555-5555-4555-8555-555555555555" }] : [],
  };
}

function orderResult(status: OrderStatus) {
  return {
    id: orderId,
    orderNumber: "MC-ORDER-1",
    pharmacyId,
    fulfillmentMethod: FulfillmentMethod.SELF_PICKUP,
    status,
    medicineSubtotal: new Prisma.Decimal("20.00"),
    deliveryFee: new Prisma.Decimal("0.00"),
    totalAmount: new Prisma.Decimal("20.00"),
    confirmedAt: status === OrderStatus.CONFIRMED ? decidedAt : null,
    createdAt: new Date("2026-08-31T10:00:00.000Z"),
  };
}

function mockDecisionSuccess(
  role: PharmacyStaffRole = PharmacyStaffRole.OWNER,
  status: OrderStatus = OrderStatus.CREATED,
  requiresPrescription = false,
  resultStatus: OrderStatus = OrderStatus.CONFIRMED,
) {
  membership(role);
  prismaMock.order.findFirst.mockResolvedValue(currentOrder(status, requiresPrescription));
  prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.order.findUnique.mockResolvedValue(orderResult(resultStatus));
}

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: "test" });
}

function expectError(response: { status: number; body: unknown }, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.body).toEqual(expect.objectContaining({ code }));
}

describe("pharmacy order decision API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prisma));
  });

  it("rejects unauthenticated and customer requests", async () => {
    const path = `/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`;
    expect((await request(app).patch(path).send({ decision: "CONFIRM" })).status).toBe(401);
    const customer = await request(app)
      .patch(path)
      .set("Authorization", authHeader(UserRole.CUSTOMER))
      .send({ decision: "CONFIRM" });
    expect(customer.status).toBe(403);
  });

  it.each([
    PharmacyStaffRole.OWNER,
    PharmacyStaffRole.MANAGER,
    PharmacyStaffRole.PHARMACIST,
  ])("allows exact-pharmacy %s to decide", async (role) => {
    mockDecisionSuccess(role);
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe(OrderStatus.CONFIRMED);
  });

  it("forbids STAFF", async () => {
    membership(PharmacyStaffRole.STAFF);
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expectError(response, 403, "FORBIDDEN");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
  });

  it("forbids missing or inactive membership", async () => {
    prismaMock.pharmacyStaff.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expectError(response, 403, "FORBIDDEN");
  });

  it.each([
    ["invalid pharmacy UUID", "bad", orderId, { decision: "CONFIRM" }],
    ["invalid order UUID", pharmacyId, "bad", { decision: "CONFIRM" }],
    ["invalid decision", pharmacyId, orderId, { decision: "APPROVE" }],
    ["unknown field", pharmacyId, orderId, { decision: "REJECT", reason: "No stock" }],
  ])("rejects %s", async (_name, pharmacy, order, body) => {
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacy}/orders/${order}/decision`)
      .set("Authorization", authHeader())
      .send(body);
    expectError(response, 400, "VALIDATION_ERROR");
  });

  it("hides a cross-pharmacy order", async () => {
    membership();
    prismaMock.order.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expectError(response, 404, "ORDER_NOT_FOUND");
    expect(prismaMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: orderId, pharmacyId } }),
    );
  });

  it("confirms a CREATED non-prescription order", async () => {
    mockDecisionSuccess();
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expect(response.status).toBe(200);
    expect(prismaMock.order.updateMany).toHaveBeenCalledWith({
      where: { id: orderId, pharmacyId, status: OrderStatus.CREATED },
      data: { status: OrderStatus.CONFIRMED, confirmedAt: expect.any(Date) },
    });
    expect(prismaMock.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });

  it("confirms a PRESCRIPTION_APPROVED Rx order", async () => {
    mockDecisionSuccess(
      PharmacyStaffRole.PHARMACIST,
      OrderStatus.PRESCRIPTION_APPROVED,
      true,
    );
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe(OrderStatus.CONFIRMED);
  });

  it("does not confirm an Rx-required order from CREATED", async () => {
    membership();
    prismaMock.order.findFirst.mockResolvedValue(
      currentOrder(OrderStatus.CREATED, true),
    );
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expectError(response, 409, "ORDER_DECISION_NOT_ALLOWED");
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    OrderStatus.PRESCRIPTION_PENDING,
    OrderStatus.PRESCRIPTION_REJECTED,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
    OrderStatus.REJECTED_BY_PHARMACY,
  ])("does not confirm from %s", async (status) => {
    membership();
    prismaMock.order.findFirst.mockResolvedValue(currentOrder(status, true));
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expectError(response, 409, "ORDER_DECISION_NOT_ALLOWED");
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [OrderStatus.CREATED, false],
    [OrderStatus.PRESCRIPTION_APPROVED, true],
  ] as const)("rejects an order from %s", async (status, requiresPrescription) => {
    mockDecisionSuccess(
      PharmacyStaffRole.MANAGER,
      status,
      requiresPrescription,
      OrderStatus.REJECTED_BY_PHARMACY,
    );
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "REJECT" });
    expect(response.status).toBe(200);
    expect(prismaMock.order.updateMany.mock.calls[0][0].data).toEqual({
      status: OrderStatus.REJECTED_BY_PHARMACY,
    });
  });

  it("does not replace prescription rejection with pharmacy rejection", async () => {
    membership();
    prismaMock.order.findFirst.mockResolvedValue(
      currentOrder(OrderStatus.PRESCRIPTION_REJECTED, true),
    );
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "REJECT" });
    expectError(response, 409, "ORDER_DECISION_NOT_ALLOWED");
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("prevents a stale decision from overwriting a completed one", async () => {
    mockDecisionSuccess();
    prismaMock.order.updateMany.mockResolvedValue({ count: 0 });
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expectError(response, 409, "ORDER_DECISION_NOT_ALLOWED");
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });

  it("retries exact P2034 and re-reads state", async () => {
    mockDecisionSuccess();
    prismaMock.order.findFirst
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce(currentOrder());
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expect(response.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMock.order.findFirst).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["missing", null],
    [
      "STAFF",
      {
        id: staffId,
        userId,
        pharmacyId,
        role: PharmacyStaffRole.STAFF,
      },
    ],
  ])("fails safely when decision membership becomes %s before retry", async (_name, retryMembership) => {
    prismaMock.pharmacyStaff.findFirst
      .mockResolvedValueOnce({
        id: staffId,
        userId,
        pharmacyId,
        role: PharmacyStaffRole.OWNER,
      })
      .mockResolvedValueOnce(retryMembership);
    prismaMock.order.findFirst.mockRejectedValueOnce(knownError("P2034"));

    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });

    expectError(response, 403, "FORBIDDEN");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(prismaMock.pharmacyStaff.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("stops when state changes during retry", async () => {
    membership();
    prismaMock.order.findFirst
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce(currentOrder(OrderStatus.CONFIRMED));
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expectError(response, 409, "ORDER_DECISION_NOT_ALLOWED");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("returns conflict after exactly three P2034 attempts", async () => {
    membership();
    prismaMock.order.findFirst.mockRejectedValue(knownError("P2034"));
    const response = await request(app)
      .patch(`/api/v1/pharmacies/${pharmacyId}/orders/${orderId}/decision`)
      .set("Authorization", authHeader())
      .send({ decision: "CONFIRM" });
    expectError(response, 409, "ORDER_DECISION_CONFLICT");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(MAX_PHARMACY_WORKFLOW_ATTEMPTS);
  });

  it("does not retry unrelated errors", async () => {
    const failure = new Error("database unavailable");
    const membershipReader = vi.fn().mockResolvedValue({
      id: staffId, userId, pharmacyId, role: PharmacyStaffRole.OWNER,
    });
    prismaMock.$transaction.mockRejectedValue(failure);
    await expect(
      decidePharmacyOrder(
        userId,
        pharmacyId,
        orderId,
        { decision: "CONFIRM" },
        prisma as never,
        membershipReader,
      ),
    ).rejects.toBe(failure);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
