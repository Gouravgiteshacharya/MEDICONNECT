import type { Prisma } from "../../../generated/prisma/client.js";
import type { EtaDatasetSourceRecord } from "./eta-dataset.types.js";

export interface EtaDatasetLoadOptions {
  readonly placedAtFrom: Date;
  readonly placedAtUntil: Date;
  /** Validated here; maturity filtering belongs exclusively to the transformer. */
  readonly outcomeCutoff: Date;
}

export const ETA_DATASET_SELECT = {
  id: true, fulfillmentMethod: true, status: true, placedAt: true, completedAt: true,
  deliveryDistanceKm: true, quotedEtaMinutes: true,
  _count: { select: { items: true } },
  deliveryAssignments: { select: { status: true, deliveredAt: true } },
} as const satisfies Prisma.OrderSelect;

type SelectedOrder = Prisma.OrderGetPayload<{ select: typeof ETA_DATASET_SELECT }>;
export interface EtaDatasetDataSource {
  readonly order: {
    findMany(args: {
      where: { placedAt: { gte: Date; lt: Date } };
      select: typeof ETA_DATASET_SELECT;
      orderBy: [{ placedAt: "asc" }, { id: "asc" }];
    }): PromiseLike<readonly SelectedOrder[]>;
  };
}

export function validateEtaLoadOptions(options: EtaDatasetLoadOptions): void {
  const valid = (date: Date) => date instanceof Date && Number.isFinite(date.getTime());
  if (![options.placedAtFrom, options.placedAtUntil, options.outcomeCutoff].every(valid)
    || options.placedAtFrom.getTime() >= options.placedAtUntil.getTime()) {
    throw new RangeError("A valid half-open placement range and outcome cutoff are required");
  }
}

/** Read-only injected boundary. No shared-client initialization occurs on import. */
export async function loadEtaDataset(
  dataSource: EtaDatasetDataSource, options: EtaDatasetLoadOptions,
): Promise<readonly EtaDatasetSourceRecord[]> {
  validateEtaLoadOptions(options);
  const orders = await dataSource.order.findMany({
    where: { placedAt: { gte: options.placedAtFrom, lt: options.placedAtUntil } },
    select: ETA_DATASET_SELECT,
    orderBy: [{ placedAt: "asc" }, { id: "asc" }],
  });
  return orders.map(order => ({
    orderId: order.id, fulfillmentMethod: order.fulfillmentMethod, orderStatus: order.status,
    placedAt: order.placedAt, completedAt: order.completedAt,
    distanceKm: order.deliveryDistanceKm, quotedEtaMinutes: order.quotedEtaMinutes,
    itemCount: order._count.items,
    assignments: order.deliveryAssignments.map(assignment => ({
      status: assignment.status, deliveredAt: assignment.deliveredAt,
    })),
  }));
}
