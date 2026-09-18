import { describe, expect, it, vi } from "vitest";

import { InventoryStatus } from "../generated/prisma/client.js";
import {
  commitInventory,
  restoreInventory,
} from "../src/services/inventoryCommitment.service.js";

const pharmacyId = "11111111-1111-4111-8111-111111111111";
const medicineA = "22222222-2222-4222-8222-222222222222";
const medicineB = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-09-18T12:00:00.000Z");

function transaction(...counts: number[]) {
  return {
    pharmacyInventory: {
      updateMany: vi.fn().mockImplementation(async () => ({
        count: counts.shift() ?? 1,
      })),
    },
  };
}

describe("inventory commitment helper", () => {
  it("atomically decrements only orderable inventory with sufficient quantity", async () => {
    const tx = transaction(1);

    await commitInventory(
      tx as never,
      pharmacyId,
      [{ medicineId: medicineA, quantity: 4 }],
      now,
    );

    expect(tx.pharmacyInventory.updateMany).toHaveBeenCalledWith({
      where: {
        pharmacyId,
        medicineId: medicineA,
        quantity: { gte: 4 },
        availability: {
          in: [InventoryStatus.AVAILABLE, InventoryStatus.LOW_STOCK],
        },
      },
      data: { quantity: { decrement: 4 }, lastUpdated: now },
    });
  });

  it("rejects an insufficient or stale transactional stock check", async () => {
    const tx = transaction(0);

    await expect(
      commitInventory(
        tx as never,
        pharmacyId,
        [{ medicineId: medicineA, quantity: 4 }],
        now,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CHECKOUT_QUANTITY_UNAVAILABLE",
    });
  });

  it("aggregates duplicates and locks multiple medicines in stable order", async () => {
    const tx = transaction(1, 1);

    await commitInventory(
      tx as never,
      pharmacyId,
      [
        { medicineId: medicineB, quantity: 1 },
        { medicineId: medicineA, quantity: 2 },
        { medicineId: medicineA, quantity: 3 },
      ],
      now,
    );

    expect(tx.pharmacyInventory.updateMany.mock.calls.map(([call]) => [
      call.where.medicineId,
      call.data.quantity.decrement,
    ])).toEqual([[medicineA, 5], [medicineB, 1]]);
  });

  it("throws when a later item cannot commit so the caller transaction rolls back", async () => {
    const tx = transaction(1, 0);

    await expect(
      commitInventory(
        tx as never,
        pharmacyId,
        [
          { medicineId: medicineA, quantity: 1 },
          { medicineId: medicineB, quantity: 1 },
        ],
        now,
      ),
    ).rejects.toMatchObject({ code: "CHECKOUT_QUANTITY_UNAVAILABLE" });
    expect(tx.pharmacyInventory.updateMany).toHaveBeenCalledTimes(2);
  });

  it("restores exact quantities without changing availability or updater identity", async () => {
    const tx = transaction(1);

    await restoreInventory(
      tx as never,
      pharmacyId,
      [{ medicineId: medicineA, quantity: 4 }],
      now,
    );

    expect(tx.pharmacyInventory.updateMany).toHaveBeenCalledWith({
      where: { pharmacyId, medicineId: medicineA },
      data: { quantity: { increment: 4 }, lastUpdated: now },
    });
  });

  it("fails safely when an inventory row cannot be restored", async () => {
    const tx = transaction(0);

    await expect(
      restoreInventory(
        tx as never,
        pharmacyId,
        [{ medicineId: medicineA, quantity: 1 }],
        now,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "INVENTORY_RESTORATION_CONFLICT",
    });
  });
});
