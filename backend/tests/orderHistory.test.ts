import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  FulfillmentMethod,
  OrderStatus,
  PrescriptionStatus,
  Prisma,
  UserRole,
} from "../generated/prisma/client.js";
import { app } from "../src/app.js";
import { signAuthToken } from "../src/utils/jwt.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    order: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

const { prisma } = await import("../src/lib/prisma.js");
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock };
  order: { findMany: Mock; findFirst: Mock };
};

const customerId = "11111111-1111-4111-8111-111111111111";
const otherCustomerId = "22222222-2222-4222-8222-222222222222";
const pharmacyId = "33333333-3333-4333-8333-333333333333";
const orderId = "44444444-4444-4444-8444-444444444444";
const secondOrderId = "55555555-5555-4555-8555-555555555555";
const thirdOrderId = "66666666-6666-4666-8666-666666666666";
const addressId = "77777777-7777-4777-8777-777777777777";
const placedAt = new Date("2026-08-31T10:00:00.000Z");

function authenticateAs(role: UserRole = UserRole.CUSTOMER) {
  prismaMock.user.findUnique.mockResolvedValueOnce({
    id: customerId,
    role,
    isActive: true,
  });
  return `Bearer ${signAuthToken({ userId: customerId, role })}`;
}

function historyOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    orderNumber: "MC-ORDER-1",
    pharmacyId,
    fulfillmentMethod: FulfillmentMethod.SELF_PICKUP,
    status: OrderStatus.CREATED,
    medicineSubtotal: new Prisma.Decimal("20.00"),
    deliveryFee: new Prisma.Decimal("0.00"),
    totalAmount: new Prisma.Decimal("20.00"),
    placedAt,
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    _count: { items: 2 },
    ...overrides,
  };
}

function detailedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    orderNumber: "MC-ORDER-1",
    pharmacyId,
    fulfillmentMethod: FulfillmentMethod.DELIVERY,
    status: OrderStatus.CONFIRMED,
    medicineSubtotal: new Prisma.Decimal("20.00"),
    deliveryFee: new Prisma.Decimal("4.50"),
    totalAmount: new Prisma.Decimal("24.50"),
    deliveryAddressId: addressId,
    deliveryAddressLabelSnapshot: "Home",
    deliveryAddressLine1Snapshot: "1 Main Road",
    deliveryAddressLine2Snapshot: "Floor 2",
    deliveryLandmarkSnapshot: "Clock Tower",
    deliveryCitySnapshot: "Bengaluru",
    deliveryStateSnapshot: "Karnataka",
    deliveryPostalCodeSnapshot: "560001",
    deliveryLatitudeSnapshot: 12.9716,
    deliveryLongitudeSnapshot: 77.5946,
    deliveryDistanceKm: 3.25,
    quotedEtaMinutes: 25,
    placedAt,
    confirmedAt: new Date("2026-08-31T10:05:00.000Z"),
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-08-31T09:59:00.000Z"),
    updatedAt: new Date("2026-08-31T10:05:00.000Z"),
    items: [
      {
        id: "80000000-0000-4000-8000-000000000001",
        medicineId: "90000000-0000-4000-8000-000000000001",
        medicineNameSnapshot: "Medicine One",
        brandNameSnapshot: "Brand One",
        manufacturerSnapshot: "Manufacturer One",
        requiresPrescription: true,
        quantity: 2,
        unitPrice: new Prisma.Decimal("10.00"),
        lineTotal: new Prisma.Decimal("20.00"),
      },
    ],
    prescriptions: [
      {
        id: "a0000000-0000-4000-8000-000000000001",
        orderId,
        fileUrl: "https://files.example.test/rx-1.pdf",
        originalFilename: "rx-1.pdf",
        status: PrescriptionStatus.PENDING_REVIEW,
        uploadedAt: new Date("2026-08-31T10:01:00.000Z"),
        reviewedAt: null,
        reviewNotes: null,
        rejectionReason: null,
      },
      {
        id: "a0000000-0000-4000-8000-000000000002",
        orderId,
        fileUrl: "https://files.example.test/rx-2.pdf",
        originalFilename: "rx-2.pdf",
        status: PrescriptionStatus.APPROVED,
        uploadedAt: new Date("2026-08-31T10:02:00.000Z"),
        reviewedAt: new Date("2026-08-31T10:03:00.000Z"),
        reviewNotes: "Verified",
        rejectionReason: null,
      },
    ],
    ...overrides,
  };
}

function expectError(
  response: { status: number; body: unknown },
  status: number,
  code: string,
) {
  expect(response.status).toBe(status);
  expect(response.body).toEqual(expect.objectContaining({ code }));
}

describe("customer order history API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/orders", () => {
    it("rejects unauthenticated and non-customer requests", async () => {
      expect((await request(app).get("/api/v1/orders")).status).toBe(401);
      const forbidden = await request(app)
        .get("/api/v1/orders")
        .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF));
      expect(forbidden.status).toBe(403);
      expect(prismaMock.order.findMany).not.toHaveBeenCalled();
    });

    it("filters by customer and uses deterministic newest-first default pagination", async () => {
      prismaMock.order.findMany.mockResolvedValue([
        historyOrder({ id: secondOrderId }),
        historyOrder(),
      ]);
      const response = await request(app)
        .get("/api/v1/orders")
        .set("Authorization", authenticateAs());

      expect(response.status).toBe(200);
      expect(response.body.orders).toHaveLength(2);
      expect(response.body.orders[0]).toEqual(
        expect.objectContaining({ id: secondOrderId, itemCount: 2 }),
      );
      expect(response.body.orders[0]).not.toHaveProperty("_count");
      expect(response.body.nextCursor).toBeNull();
      expect(prismaMock.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId },
          orderBy: [{ placedAt: "desc" }, { id: "desc" }],
          take: 21,
        }),
      );
    });

    it("accepts a bounded custom limit and exact status filter", async () => {
      prismaMock.order.findMany.mockResolvedValue([]);
      const response = await request(app)
        .get("/api/v1/orders?limit=5&status=DELIVERED")
        .set("Authorization", authenticateAs());
      expect(response.status).toBe(200);
      expect(prismaMock.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId, status: OrderStatus.DELIVERED },
          take: 6,
        }),
      );
    });

    it.each([
      ["limit below minimum", "?limit=0"],
      ["limit above maximum", "?limit=51"],
      ["non-integer limit", "?limit=1.5"],
      ["invalid cursor", "?cursor=bad"],
      ["invalid status", "?status=UNKNOWN"],
      ["unknown query", "?page=2"],
    ])("rejects %s", async (_name, query) => {
      const response = await request(app)
        .get(`/api/v1/orders${query}`)
        .set("Authorization", authenticateAs());
      expectError(response, 400, "VALIDATION_ERROR");
      expect(prismaMock.order.findMany).not.toHaveBeenCalled();
    });

    it("returns nextCursor when limit plus one records exist", async () => {
      prismaMock.order.findMany.mockResolvedValue([
        historyOrder({ id: orderId }),
        historyOrder({ id: secondOrderId }),
        historyOrder({ id: thirdOrderId }),
      ]);
      const response = await request(app)
        .get("/api/v1/orders?limit=2")
        .set("Authorization", authenticateAs());
      expect(response.status).toBe(200);
      expect(response.body.orders.map((order: { id: string }) => order.id)).toEqual([
        orderId,
        secondOrderId,
      ]);
      expect(response.body.nextCursor).toBe(secondOrderId);
    });

    it("applies a cursor and omits nextCursor on the final page", async () => {
      prismaMock.order.findMany.mockResolvedValue([historyOrder({ id: thirdOrderId })]);
      const response = await request(app)
        .get(`/api/v1/orders?limit=2&cursor=${secondOrderId}`)
        .set("Authorization", authenticateAs());
      expect(response.status).toBe(200);
      expect(response.body.nextCursor).toBeNull();
      expect(prismaMock.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: secondOrderId }, skip: 1 }),
      );
    });

    it("returns an empty final page", async () => {
      prismaMock.order.findMany.mockResolvedValue([]);
      const response = await request(app)
        .get("/api/v1/orders")
        .set("Authorization", authenticateAs());
      expect(response.body).toEqual({ orders: [], nextCursor: null });
    });

    it("represents every authoritative OrderStatus without synthesizing history", async () => {
      const statuses = Object.values(OrderStatus);
      prismaMock.order.findMany.mockResolvedValue(
        statuses.map((status, index) =>
          historyOrder({
            id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            status,
          }),
        ),
      );
      const response = await request(app)
        .get("/api/v1/orders?limit=20")
        .set("Authorization", authenticateAs());
      expect(response.status).toBe(200);
      expect(response.body.orders.map((order: { status: string }) => order.status)).toEqual(statuses);
      for (const order of response.body.orders) {
        expect(order).not.toHaveProperty("preparingAt");
        expect(order).not.toHaveProperty("readyForPickupAt");
        expect(order).not.toHaveProperty("outForDeliveryAt");
      }
    });
  });

  describe("GET /api/v1/orders/:orderId", () => {
    it("rejects unauthenticated and non-customer requests", async () => {
      expect((await request(app).get(`/api/v1/orders/${orderId}`)).status).toBe(401);
      const forbidden = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set("Authorization", authenticateAs(UserRole.PHARMACY_STAFF));
      expect(forbidden.status).toBe(403);
    });

    it("rejects an invalid order UUID", async () => {
      const response = await request(app)
        .get("/api/v1/orders/not-a-uuid")
        .set("Authorization", authenticateAs());
      expectError(response, 400, "VALIDATION_ERROR");
    });

    it("returns ORDER_NOT_FOUND for nonexistent or cross-customer orders", async () => {
      prismaMock.order.findFirst.mockResolvedValue(null);
      const response = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set("Authorization", authenticateAs());
      expectError(response, 404, "ORDER_NOT_FOUND");
      expect(prismaMock.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: orderId, customerId } }),
      );
      expect(prismaMock.order.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: orderId, customerId: otherCustomerId } }),
      );
    });

    it("returns complete customer-safe snapshots and deterministic relations", async () => {
      prismaMock.order.findFirst.mockResolvedValue(detailedOrder());
      const response = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set("Authorization", authenticateAs());
      expect(response.status).toBe(200);
      expect(response.body.order).toEqual(
        expect.objectContaining({
          id: orderId,
          pharmacyId,
          medicineSubtotal: "20",
          deliveryFee: "4.5",
          totalAmount: "24.5",
          deliveryAddressId: addressId,
          deliveryAddressLabelSnapshot: "Home",
          deliveryLatitudeSnapshot: 12.9716,
          deliveryDistanceKm: 3.25,
          quotedEtaMinutes: 25,
          confirmedAt: "2026-08-31T10:05:00.000Z",
          completedAt: null,
          cancelledAt: null,
        }),
      );
      expect(response.body.order.items[0]).toEqual(
        expect.objectContaining({
          medicineNameSnapshot: "Medicine One",
          requiresPrescription: true,
          unitPrice: "10",
          lineTotal: "20",
        }),
      );
      expect(response.body.order.prescriptions).toHaveLength(2);
      expect(response.body.order.prescriptions[1].status).toBe(PrescriptionStatus.APPROVED);

      const select = prismaMock.order.findFirst.mock.calls[0][0].select;
      expect(select.items.orderBy).toEqual({ id: "asc" });
      expect(select.prescriptions.orderBy).toEqual([
        { uploadedAt: "asc" },
        { id: "asc" },
      ]);
      expect(select.prescriptions.select).not.toHaveProperty("storagePath");
      expect(select.prescriptions.select).not.toHaveProperty("reviewerStaffId");
      expect(select).not.toHaveProperty("deliveryAssignments");
      expect(select).not.toHaveProperty("dispatchAttempts");
      for (const prescription of response.body.order.prescriptions) {
        expect(prescription).not.toHaveProperty("storagePath");
        expect(prescription).not.toHaveProperty("reviewerStaffId");
      }
    });

    it("preserves null delivery snapshots for SELF_PICKUP", async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        detailedOrder({
          fulfillmentMethod: FulfillmentMethod.SELF_PICKUP,
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
        }),
      );
      const response = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set("Authorization", authenticateAs());
      expect(response.status).toBe(200);
      expect(response.body.order).toEqual(
        expect.objectContaining({
          deliveryAddressId: null,
          deliveryAddressLabelSnapshot: null,
          deliveryLatitudeSnapshot: null,
          deliveryLongitudeSnapshot: null,
          deliveryDistanceKm: null,
          quotedEtaMinutes: null,
        }),
      );
    });
  });
});
