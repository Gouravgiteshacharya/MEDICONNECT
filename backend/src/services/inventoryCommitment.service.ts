import {
  InventoryStatus,
  type Prisma,
} from "../../generated/prisma/client.js";

import { ApiError } from "../utils/ApiError.js";

export type InventoryCommitmentTransaction = Pick<
  Prisma.TransactionClient,
  "pharmacyInventory"
>;

export type InventoryRequirement = {
  medicineId: string | null;
  quantity: number;
};

function checkoutQuantityUnavailableError() {
  return new ApiError(
    409,
    "A requested cart quantity is no longer available.",
    "CHECKOUT_QUANTITY_UNAVAILABLE",
  );
}

function inventoryRestorationConflictError() {
  return new ApiError(
    409,
    "Committed inventory could not be restored safely.",
    "INVENTORY_RESTORATION_CONFLICT",
  );
}

function aggregateRequirements(requirements: InventoryRequirement[]) {
  const quantities = new Map<string, number>();

  for (const requirement of requirements) {
    if (!requirement.medicineId || requirement.quantity <= 0) {
      throw inventoryRestorationConflictError();
    }

    quantities.set(
      requirement.medicineId,
      (quantities.get(requirement.medicineId) ?? 0) + requirement.quantity,
    );
  }

  return [...quantities.entries()]
    .map(([medicineId, quantity]) => ({ medicineId, quantity }))
    .sort((left, right) => left.medicineId.localeCompare(right.medicineId));
}

export async function commitInventory(
  tx: InventoryCommitmentTransaction,
  pharmacyId: string,
  requirements: InventoryRequirement[],
  now: Date,
) {
  for (const requirement of aggregateRequirements(requirements)) {
    const result = await tx.pharmacyInventory.updateMany({
      where: {
        pharmacyId,
        medicineId: requirement.medicineId,
        quantity: { gte: requirement.quantity },
        availability: {
          in: [InventoryStatus.AVAILABLE, InventoryStatus.LOW_STOCK],
        },
      },
      data: {
        quantity: { decrement: requirement.quantity },
        lastUpdated: now,
      },
    });

    if (result.count !== 1) throw checkoutQuantityUnavailableError();
  }
}

export async function restoreInventory(
  tx: InventoryCommitmentTransaction,
  pharmacyId: string,
  requirements: InventoryRequirement[],
  now: Date,
) {
  for (const requirement of aggregateRequirements(requirements)) {
    const result = await tx.pharmacyInventory.updateMany({
      where: {
        pharmacyId,
        medicineId: requirement.medicineId,
      },
      data: {
        quantity: { increment: requirement.quantity },
        lastUpdated: now,
      },
    });

    if (result.count !== 1) throw inventoryRestorationConflictError();
  }
}
