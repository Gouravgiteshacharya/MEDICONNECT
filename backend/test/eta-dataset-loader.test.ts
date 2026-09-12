import { describe, expect, it, vi } from "vitest";
import { loadEtaDataset, type EtaDatasetDataSource } from "../src/ml/dataset/eta-dataset.loader.js";

describe("read-only ETA loader", () => {
  const options = { placedAtFrom: new Date("2026-01-01T00:00:00Z"), placedAtUntil: new Date("2026-04-01T00:00:00Z"), outcomeCutoff: new Date("2026-04-02T00:00:00Z") };
  it("requires only findMany and sends the exact minimal projection, range and stable ordering", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const dataSource: EtaDatasetDataSource = { order: { findMany } };
    expect(await loadEtaDataset(dataSource, options)).toEqual([]);
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { placedAt: { gte: options.placedAtFrom, lt: options.placedAtUntil } },
      select: {
        id: true, fulfillmentMethod: true, status: true, placedAt: true, completedAt: true,
        deliveryDistanceKm: true, quotedEtaMinutes: true,
        _count: { select: { items: true } },
        deliveryAssignments: { select: { status: true, deliveredAt: true } },
      },
      orderBy: [{ placedAt: "asc" }, { id: "asc" }],
    });
    expect(Object.keys(dataSource.order)).toEqual(["findMany"]);
    const query = JSON.stringify(findMany.mock.calls[0]);
    for (const forbidden of ["customer", "rider", "latitude", "longitude", "prescription", "quantity", "pharmacy", "address"]) expect(query).not.toContain(forbidden);
  });
  it("maps stored snapshots and assignment outcomes field-by-field, counting item lines rather than quantities", async () => {
    const deliveredAt = new Date("2026-01-01T00:30:00Z");
    const raw = {
      id: "internal-order", fulfillmentMethod: "DELIVERY", status: "DELIVERED", placedAt: options.placedAtFrom,
      completedAt: deliveredAt, deliveryDistanceKm: 5.123, quotedEtaMinutes: 19,
      _count: { items: 2 }, items: [{ quantity: 100 }, { quantity: 200 }], customer: { phone: "private" },
      deliveryAssignments: [{ status: "FAILED", deliveredAt: null, riderId: "private" }, { status: "DELIVERED", deliveredAt }],
    };
    const records = await loadEtaDataset({ order: { findMany: vi.fn().mockResolvedValue([raw]) } }, options);
    expect(records).toEqual([{
      orderId: "internal-order", fulfillmentMethod: "DELIVERY", orderStatus: "DELIVERED", placedAt: options.placedAtFrom,
      completedAt: deliveredAt, distanceKm: 5.123, quotedEtaMinutes: 19, itemCount: 2,
      assignments: [{ status: "FAILED", deliveredAt: null }, { status: "DELIVERED", deliveredAt }],
    }]);
    expect(records[0]).not.toBe(raw);
    expect(records[0].assignments).not.toBe(raw.deliveryAssignments);
  });
  it.each([
    { placedAtFrom: new Date(NaN) }, { placedAtUntil: new Date(NaN) },
    { outcomeCutoff: new Date(NaN) }, { placedAtUntil: options.placedAtFrom },
  ])("rejects invalid range/cutoff before any read: %j", async overrides => {
    const findMany = vi.fn();
    await expect(loadEtaDataset({ order: { findMany } }, { ...options, ...overrides })).rejects.toThrow(RangeError);
    expect(findMany).not.toHaveBeenCalled();
  });
});
