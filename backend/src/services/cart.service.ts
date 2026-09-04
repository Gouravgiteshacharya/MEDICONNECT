import {
  CartStatus,
  Prisma,
  FulfillmentMethod,
  type PrismaClient,
} from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import type {
  AddCartItemInput,
  UpdateCartFulfillmentInput,
} from "../validators/cart.schemas.js";
import {
  getOrderableInventorySnapshot,
  type OrderableInventorySnapshot,
} from "./inventory.service.js";

export const MAX_CART_TRANSACTION_ATTEMPTS = 3;

type InventorySnapshotReader = (
  pharmacyId: string,
  medicineId: string,
) => Promise<OrderableInventorySnapshot | null>;

type CartTransactionClient = Pick<
  Prisma.TransactionClient,
  "address" | "cart" | "cartItem"
>;

export type CartDataSource = Pick<
  PrismaClient,
  "address" | "cart" | "cartItem"
> & {
  $transaction<T>(
    callback: (tx: CartTransactionClient) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
};

const cartItemSelect = {
  id: true,
  medicineId: true,
  quantity: true,
  createdAt: true,
  updatedAt: true,
  medicine: {
    select: {
      id: true,
      name: true,
      brandName: true,
      genericName: true,
      manufacturer: true,
      requiresPrescription: true,
    },
  },
} satisfies Prisma.CartItemSelect;

const cartSelect = {
  id: true,
  pharmacyId: true,
  deliveryAddressId: true,
  fulfillmentMethod: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: cartItemSelect,
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.CartSelect;

type CartRecord = Prisma.CartGetPayload<{ select: typeof cartSelect }>;
type CartItemRecord = Prisma.CartItemGetPayload<{
  select: typeof cartItemSelect;
}>;

function cartItemNotFoundError() {
  return new ApiError(404, "Cart item not found.", "CART_ITEM_NOT_FOUND");
}

function cartNotFoundError() {
  return new ApiError(404, "Cart not found.", "CART_NOT_FOUND");
}

function addressNotFoundError() {
  return new ApiError(404, "Address not found.", "ADDRESS_NOT_FOUND");
}

function cartItemNotOrderableError() {
  return new ApiError(
    409,
    "This medicine is not currently orderable from the selected pharmacy.",
    "CART_ITEM_NOT_ORDERABLE",
  );
}

function cartQuantityUnavailableError() {
  return new ApiError(
    409,
    "The requested quantity is not currently available.",
    "CART_QUANTITY_UNAVAILABLE",
  );
}

function cartPharmacyConflictError() {
  return new ApiError(
    409,
    "Your active cart belongs to a different pharmacy.",
    "CART_PHARMACY_CONFLICT",
  );
}

function cartStateConflictError() {
  return new ApiError(
    409,
    "The active cart cannot be updated in its current state.",
    "CART_STATE_CONFLICT",
  );
}

function cartUpdateConflictError() {
  return new ApiError(
    409,
    "The cart changed during this request. Please try again.",
    "CART_UPDATE_CONFLICT",
  );
}

function isTransactionConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function isCartItemCompoundUniqueConflict(error: unknown) {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002" ||
    !Array.isArray(error.meta?.target)
  ) {
    return false;
  }

  const target = error.meta.target;

  return (
    target.length === 2 &&
    target[0] === "cartId" &&
    target[1] === "medicineId"
  );
}

function isRetryableCartConflict(error: unknown) {
  return (
    isTransactionConflict(error) || isCartItemCompoundUniqueConflict(error)
  );
}

function assertSnapshotQuantity(
  requestedQuantity: number,
  snapshot: OrderableInventorySnapshot,
) {
  if (requestedQuantity > snapshot.quantity) {
    throw cartQuantityUnavailableError();
  }
}

async function readOrderableSnapshot(
  pharmacyId: string,
  medicineId: string,
  snapshotReader: InventorySnapshotReader,
) {
  const snapshot = await snapshotReader(pharmacyId, medicineId);

  if (!snapshot) {
    throw cartItemNotOrderableError();
  }

  return snapshot;
}

export async function getActiveCustomerCart(
  customerId: string,
  dataSource: CartDataSource = prisma,
): Promise<CartRecord | null> {
  return dataSource.cart.findFirst({
    where: { customerId, status: CartStatus.ACTIVE },
    select: cartSelect,
    orderBy: { createdAt: "asc" },
  });
}

async function updateCartFulfillmentAttempt(
  customerId: string,
  input: UpdateCartFulfillmentInput,
  dataSource: CartDataSource,
): Promise<CartRecord> {
  return dataSource.$transaction(
    async (tx) => {
      const activeCarts = await tx.cart.findMany({
        where: { customerId, status: CartStatus.ACTIVE },
        select: {
          id: true,
          pharmacyId: true,
          _count: { select: { items: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 2,
      });

      if (activeCarts.length === 0) throw cartNotFoundError();
      if (activeCarts.length > 1) throw cartStateConflictError();

      const cart = activeCarts[0];

      if (!cart || cart.pharmacyId === null || cart._count.items === 0) {
        throw cartStateConflictError();
      }

      let deliveryAddressId: string | null = null;

      if (input.fulfillmentMethod === FulfillmentMethod.DELIVERY) {
        const address = await tx.address.findFirst({
          where: {
            id: input.deliveryAddressId,
            userId: customerId,
          },
          select: { id: true },
        });

        if (!address) throw addressNotFoundError();

        deliveryAddressId = address.id;
      }

      const [updatedCart] = await tx.cart.updateManyAndReturn({
        where: {
          id: cart.id,
          customerId,
          status: CartStatus.ACTIVE,
          pharmacyId: { not: null },
          items: { some: {} },
        },
        data: {
          fulfillmentMethod: input.fulfillmentMethod,
          deliveryAddressId,
        },
        select: cartSelect,
      });

      if (!updatedCart) throw cartStateConflictError();

      return updatedCart;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function updateActiveCartFulfillment(
  customerId: string,
  input: UpdateCartFulfillmentInput,
  dataSource: CartDataSource = prisma,
): Promise<CartRecord> {
  for (
    let attempt = 1;
    attempt <= MAX_CART_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await updateCartFulfillmentAttempt(customerId, input, dataSource);
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      if (attempt === MAX_CART_TRANSACTION_ATTEMPTS) {
        throw cartUpdateConflictError();
      }
    }
  }

  throw cartUpdateConflictError();
}

async function addCartItemAttempt(
  customerId: string,
  input: AddCartItemInput,
  snapshot: OrderableInventorySnapshot,
  dataSource: CartDataSource,
): Promise<CartItemRecord> {
  return dataSource.$transaction(
    async (tx) => {
      const activeCarts = await tx.cart.findMany({
        where: { customerId, status: CartStatus.ACTIVE },
        select: {
          id: true,
          pharmacyId: true,
          _count: { select: { items: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 2,
      });

      if (activeCarts.length > 1) {
        throw cartStateConflictError();
      }

      let cart = activeCarts[0];

      if (!cart) {
        cart = await tx.cart.create({
          data: {
            customerId,
            pharmacyId: input.pharmacyId,
            status: CartStatus.ACTIVE,
          },
          select: {
            id: true,
            pharmacyId: true,
            _count: { select: { items: true } },
          },
        });
      } else if (cart.pharmacyId === null) {
        if (cart._count.items !== 0) {
          throw cartStateConflictError();
        }

        const bound = await tx.cart.updateMany({
          where: {
            id: cart.id,
            customerId,
            status: CartStatus.ACTIVE,
            pharmacyId: null,
            items: { none: {} },
          },
          data: { pharmacyId: input.pharmacyId },
        });

        if (bound.count !== 1) {
          throw cartStateConflictError();
        }

        cart = { ...cart, pharmacyId: input.pharmacyId };
      } else if (cart.pharmacyId !== input.pharmacyId) {
        throw cartPharmacyConflictError();
      }

      const existingItem = await tx.cartItem.findUnique({
        where: {
          cartId_medicineId: {
            cartId: cart.id,
            medicineId: input.medicineId,
          },
        },
        select: { id: true, quantity: true },
      });
      const resultingQuantity =
        (existingItem?.quantity ?? 0) + input.quantity;

      assertSnapshotQuantity(resultingQuantity, snapshot);

      if (!existingItem) {
        return tx.cartItem.create({
          data: {
            cartId: cart.id,
            medicineId: input.medicineId,
            quantity: resultingQuantity,
          },
          select: cartItemSelect,
        });
      }

      const [updatedItem] = await tx.cartItem.updateManyAndReturn({
        where: {
          id: existingItem.id,
          cartId: cart.id,
          medicineId: input.medicineId,
        },
        data: { quantity: resultingQuantity },
        select: cartItemSelect,
      });

      if (!updatedItem) {
        throw cartStateConflictError();
      }

      return updatedItem;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function addMedicineToCustomerCart(
  customerId: string,
  input: AddCartItemInput,
  dataSource: CartDataSource = prisma,
  snapshotReader: InventorySnapshotReader = getOrderableInventorySnapshot,
): Promise<CartItemRecord> {
  for (
    let attempt = 1;
    attempt <= MAX_CART_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    const snapshot = await readOrderableSnapshot(
      input.pharmacyId,
      input.medicineId,
      snapshotReader,
    );
    assertSnapshotQuantity(input.quantity, snapshot);

    try {
      return await addCartItemAttempt(customerId, input, snapshot, dataSource);
    } catch (error) {
      if (!isRetryableCartConflict(error)) throw error;
      if (attempt === MAX_CART_TRANSACTION_ATTEMPTS) {
        throw cartUpdateConflictError();
      }
    }
  }

  throw cartUpdateConflictError();
}

async function resolvePatchCartItemContext(
  customerId: string,
  itemId: string,
  dataSource: CartDataSource,
) {
  const item = await dataSource.cartItem.findFirst({
    where: {
      id: itemId,
      cart: { customerId, status: CartStatus.ACTIVE },
    },
    select: {
      medicineId: true,
      cart: { select: { pharmacyId: true } },
    },
  });

  if (!item) throw cartItemNotFoundError();
  if (item.cart.pharmacyId === null) throw cartStateConflictError();

  return item as {
    medicineId: string;
    cart: { pharmacyId: string };
  };
}

async function updateCartItemQuantityAttempt(
  customerId: string,
  itemId: string,
  medicineId: string,
  pharmacyId: string,
  quantity: number,
  dataSource: CartDataSource,
): Promise<CartItemRecord> {
  return dataSource.$transaction(
    async (tx) => {
      const item = await tx.cartItem.findFirst({
        where: {
          id: itemId,
          medicineId,
          cart: {
            customerId,
            status: CartStatus.ACTIVE,
            pharmacyId,
          },
        },
        select: { id: true },
      });

      if (!item) throw cartItemNotFoundError();

      const [updatedItem] = await tx.cartItem.updateManyAndReturn({
        where: {
          id: item.id,
          medicineId,
          cart: {
            customerId,
            status: CartStatus.ACTIVE,
            pharmacyId,
          },
        },
        data: { quantity },
        select: cartItemSelect,
      });

      if (!updatedItem) throw cartItemNotFoundError();

      return updatedItem;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function updateActiveCartItemQuantity(
  customerId: string,
  itemId: string,
  quantity: number,
  dataSource: CartDataSource = prisma,
  snapshotReader: InventorySnapshotReader = getOrderableInventorySnapshot,
): Promise<CartItemRecord> {
  for (
    let attempt = 1;
    attempt <= MAX_CART_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    const context = await resolvePatchCartItemContext(
      customerId,
      itemId,
      dataSource,
    );
    const snapshot = await readOrderableSnapshot(
      context.cart.pharmacyId,
      context.medicineId,
      snapshotReader,
    );
    assertSnapshotQuantity(quantity, snapshot);

    try {
      return await updateCartItemQuantityAttempt(
        customerId,
        itemId,
        context.medicineId,
        context.cart.pharmacyId,
        quantity,
        dataSource,
      );
    } catch (error) {
      if (!isRetryableCartConflict(error)) throw error;
      if (attempt === MAX_CART_TRANSACTION_ATTEMPTS) {
        throw cartUpdateConflictError();
      }
    }
  }

  throw cartUpdateConflictError();
}

export async function removeActiveCartItem(
  customerId: string,
  itemId: string,
  dataSource: CartDataSource = prisma,
): Promise<void> {
  const result = await dataSource.cartItem.deleteMany({
    where: {
      id: itemId,
      cart: { customerId, status: CartStatus.ACTIVE },
    },
  });

  if (result.count === 0) throw cartItemNotFoundError();
}
