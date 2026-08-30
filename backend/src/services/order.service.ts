import { randomUUID } from "node:crypto";

import {
  CartStatus,
  FulfillmentMethod,
  OrderStatus,
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import type { CreateOrderInput } from "../validators/order.schemas.js";
import {
  getOrderableInventorySnapshot,
  type OrderableInventorySnapshot,
} from "./inventory.service.js";
import {
  getMedicineDetail,
  type MedicineDetail,
} from "./medicine.service.js";

export const MAX_CHECKOUT_ATTEMPTS = 3;

type InventorySnapshotReader = (
  pharmacyId: string,
  medicineId: string,
) => Promise<OrderableInventorySnapshot | null>;
type MedicineDetailReader = (medicineId: string) => Promise<MedicineDetail>;
type OrderNumberGenerator = (now: Date) => string;
type CheckoutClock = () => Date;
type OrderTransactionClient = Pick<
  Prisma.TransactionClient,
  "address" | "cart" | "deliveryQuote" | "order"
>;

export type OrderDataSource = Pick<
  PrismaClient,
  "cart" | "address" | "deliveryQuote" | "order"
> & {
  $transaction<T>(
    callback: (tx: OrderTransactionClient) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
};

const checkoutCartSelect = {
  id: true,
  pharmacyId: true,
  deliveryAddressId: true,
  fulfillmentMethod: true,
  items: {
    select: { id: true, medicineId: true, quantity: true },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.CartSelect;

const orderSelect = {
  id: true,
  orderNumber: true,
  customerId: true,
  pharmacyId: true,
  deliveryAddressId: true,
  fulfillmentMethod: true,
  status: true,
  deliveryAddressLabelSnapshot: true,
  deliveryAddressLine1Snapshot: true,
  deliveryAddressLine2Snapshot: true,
  deliveryLandmarkSnapshot: true,
  deliveryCitySnapshot: true,
  deliveryStateSnapshot: true,
  deliveryPostalCodeSnapshot: true,
  deliveryLatitudeSnapshot: true,
  deliveryLongitudeSnapshot: true,
  medicineSubtotal: true,
  deliveryFee: true,
  totalAmount: true,
  deliveryDistanceKm: true,
  quotedEtaMinutes: true,
  placedAt: true,
  items: {
    select: {
      id: true,
      medicineId: true,
      medicineNameSnapshot: true,
      brandNameSnapshot: true,
      manufacturerSnapshot: true,
      requiresPrescription: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
    },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.OrderSelect;

type CheckoutCart = Prisma.CartGetPayload<{
  select: typeof checkoutCartSelect;
}>;
type CreatedOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

type PreparedItem = {
  cartItemId: string;
  medicineId: string;
  medicineNameSnapshot: string;
  brandNameSnapshot: string | null;
  manufacturerSnapshot: string | null;
  requiresPrescription: boolean;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

type PreparedCheckout = {
  cart: CheckoutCart;
  items: PreparedItem[];
  medicineSubtotal: Prisma.Decimal;
  status: OrderStatus;
};

function cartNotFoundError() {
  return new ApiError(404, "Cart not found.", "CART_NOT_FOUND");
}

function cartStateConflictError() {
  return new ApiError(
    409,
    "The active cart cannot be checked out in its current state.",
    "CART_STATE_CONFLICT",
  );
}

function cartFulfillmentConflictError() {
  return new ApiError(
    409,
    "The requested fulfillment method does not match the active cart.",
    "CART_FULFILLMENT_CONFLICT",
  );
}

function checkoutItemNotOrderableError() {
  return new ApiError(
    409,
    "A cart item is no longer orderable.",
    "CHECKOUT_ITEM_NOT_ORDERABLE",
  );
}

function checkoutQuantityUnavailableError() {
  return new ApiError(
    409,
    "A requested cart quantity is no longer available.",
    "CHECKOUT_QUANTITY_UNAVAILABLE",
  );
}

function addressNotFoundError() {
  return new ApiError(404, "Address not found.", "ADDRESS_NOT_FOUND");
}

function deliveryQuoteInvalidError() {
  return new ApiError(
    409,
    "The selected delivery quote is invalid for this checkout.",
    "DELIVERY_QUOTE_INVALID",
  );
}

function deliveryQuoteAlreadyUsedError() {
  return new ApiError(
    409,
    "The selected delivery quote has already been used.",
    "DELIVERY_QUOTE_ALREADY_USED",
  );
}

function deliveryQuoteExpiredError() {
  return new ApiError(
    409,
    "The selected delivery quote has expired.",
    "DELIVERY_QUOTE_EXPIRED",
  );
}

function checkoutConflictError() {
  return new ApiError(
    409,
    "Checkout changed during this request. Please try again.",
    "CHECKOUT_CONFLICT",
  );
}

function isTransactionConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function isOrderNumberConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    error.meta.target.length === 1 &&
    error.meta.target[0] === "orderNumber"
  );
}

function isRetryableCheckoutConflict(error: unknown) {
  return isTransactionConflict(error) || isOrderNumberConflict(error);
}

function generateOrderNumber(now: Date) {
  return `MC-${now.getTime()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function validateCart(cart: CheckoutCart | undefined, input: CreateOrderInput) {
  if (!cart) throw cartNotFoundError();
  if (
    !cart.pharmacyId ||
    !cart.fulfillmentMethod ||
    cart.items.length === 0
  ) {
    throw cartStateConflictError();
  }
  if (cart.fulfillmentMethod !== input.fulfillmentMethod) {
    throw cartFulfillmentConflictError();
  }
  if (
    cart.fulfillmentMethod === FulfillmentMethod.DELIVERY &&
    !cart.deliveryAddressId
  ) {
    throw cartStateConflictError();
  }
  if (
    cart.fulfillmentMethod === FulfillmentMethod.SELF_PICKUP &&
    cart.deliveryAddressId !== null
  ) {
    throw cartStateConflictError();
  }
}

async function loadSingleActiveCart(
  customerId: string,
  input: CreateOrderInput,
  cartDelegate: Pick<PrismaClient, "cart">["cart"],
) {
  const carts = await cartDelegate.findMany({
    where: { customerId, status: CartStatus.ACTIVE },
    select: checkoutCartSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 2,
  });

  if (carts.length > 1) throw cartStateConflictError();
  const cart = carts[0];
  validateCart(cart, input);

  return cart as CheckoutCart;
}

async function prepareCheckout(
  customerId: string,
  input: CreateOrderInput,
  dataSource: OrderDataSource,
  inventoryReader: InventorySnapshotReader,
  medicineReader: MedicineDetailReader,
): Promise<PreparedCheckout> {
  const cart = await loadSingleActiveCart(customerId, input, dataSource.cart);
  const items: PreparedItem[] = [];
  let medicineSubtotal = new Prisma.Decimal(0);

  for (const cartItem of cart.items) {
    const snapshot = await inventoryReader(
      cart.pharmacyId as string,
      cartItem.medicineId,
    );

    if (!snapshot) throw checkoutItemNotOrderableError();
    if (cartItem.quantity > snapshot.quantity) {
      throw checkoutQuantityUnavailableError();
    }

    let medicine: MedicineDetail;

    try {
      medicine = await medicineReader(cartItem.medicineId);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.statusCode === 404 &&
        error.code === "MEDICINE_NOT_FOUND"
      ) {
        throw checkoutItemNotOrderableError();
      }

      throw error;
    }

    const unitPrice = new Prisma.Decimal(snapshot.sellingPrice);
    const lineTotal = unitPrice.mul(cartItem.quantity);
    medicineSubtotal = medicineSubtotal.add(lineTotal);
    items.push({
      cartItemId: cartItem.id,
      medicineId: cartItem.medicineId,
      medicineNameSnapshot: medicine.name,
      brandNameSnapshot: medicine.brandName,
      manufacturerSnapshot: medicine.manufacturer,
      requiresPrescription: snapshot.requiresPrescription,
      quantity: cartItem.quantity,
      unitPrice,
      lineTotal,
    });
  }

  return {
    cart,
    items,
    medicineSubtotal,
    status: items.some((item) => item.requiresPrescription)
      ? OrderStatus.PRESCRIPTION_PENDING
      : OrderStatus.CREATED,
  };
}

function cartStillMatches(current: CheckoutCart, prepared: CheckoutCart) {
  return (
    current.id === prepared.id &&
    current.pharmacyId === prepared.pharmacyId &&
    current.deliveryAddressId === prepared.deliveryAddressId &&
    current.fulfillmentMethod === prepared.fulfillmentMethod &&
    current.items.length === prepared.items.length &&
    current.items.every((item, index) => {
      const expected = prepared.items[index];
      return (
        expected &&
        item.id === expected.id &&
        item.medicineId === expected.medicineId &&
        item.quantity === expected.quantity
      );
    })
  );
}

type QuoteRecord = {
  id: string;
  customerId: string;
  pharmacyId: string;
  deliveryAddressId: string | null;
  orderId: string | null;
  finalDeliveryFee: Prisma.Decimal;
  distanceKm: number;
  estimatedDurationMinutes: number | null;
  expiresAt: Date | null;
};

function validateQuote(
  quote: QuoteRecord | null,
  customerId: string,
  pharmacyId: string,
  deliveryAddressId: string,
  now: Date,
) {
  if (
    !quote ||
    quote.customerId !== customerId ||
    quote.pharmacyId !== pharmacyId ||
    quote.deliveryAddressId !== deliveryAddressId
  ) {
    throw deliveryQuoteInvalidError();
  }
  if (quote.orderId !== null) throw deliveryQuoteAlreadyUsedError();
  if (quote.expiresAt && quote.expiresAt <= now) {
    throw deliveryQuoteExpiredError();
  }

  return quote;
}

async function createOrderAttempt(
  customerId: string,
  input: CreateOrderInput,
  prepared: PreparedCheckout,
  orderNumber: string,
  now: Date,
  dataSource: OrderDataSource,
): Promise<CreatedOrder> {
  return dataSource.$transaction(
    async (tx) => {
      const currentCart = await loadSingleActiveCart(customerId, input, tx.cart);

      if (!cartStillMatches(currentCart, prepared.cart)) {
        throw checkoutConflictError();
      }

      let addressSnapshots = {
        deliveryAddressId: null as string | null,
        deliveryAddressLabelSnapshot: null as string | null,
        deliveryAddressLine1Snapshot: null as string | null,
        deliveryAddressLine2Snapshot: null as string | null,
        deliveryLandmarkSnapshot: null as string | null,
        deliveryCitySnapshot: null as string | null,
        deliveryStateSnapshot: null as string | null,
        deliveryPostalCodeSnapshot: null as string | null,
        deliveryLatitudeSnapshot: null as number | null,
        deliveryLongitudeSnapshot: null as number | null,
      };
      let quote: QuoteRecord | null = null;
      let deliveryFee = new Prisma.Decimal(0);
      let deliveryDistanceKm: number | null = null;
      let quotedEtaMinutes: number | null = null;

      if (input.fulfillmentMethod === FulfillmentMethod.DELIVERY) {
        const deliveryAddressId = currentCart.deliveryAddressId as string;
        const address = await tx.address.findFirst({
          where: { id: deliveryAddressId, userId: customerId },
          select: {
            id: true,
            label: true,
            addressLine1: true,
            addressLine2: true,
            landmark: true,
            city: true,
            state: true,
            postalCode: true,
            latitude: true,
            longitude: true,
          },
        });
        if (!address) throw addressNotFoundError();

        quote = validateQuote(
          await tx.deliveryQuote.findUnique({
            where: { id: input.deliveryQuoteId },
            select: {
              id: true,
              customerId: true,
              pharmacyId: true,
              deliveryAddressId: true,
              orderId: true,
              finalDeliveryFee: true,
              distanceKm: true,
              estimatedDurationMinutes: true,
              expiresAt: true,
            },
          }),
          customerId,
          currentCart.pharmacyId as string,
          deliveryAddressId,
          now,
        );
        addressSnapshots = {
          deliveryAddressId: address.id,
          deliveryAddressLabelSnapshot: address.label,
          deliveryAddressLine1Snapshot: address.addressLine1,
          deliveryAddressLine2Snapshot: address.addressLine2,
          deliveryLandmarkSnapshot: address.landmark,
          deliveryCitySnapshot: address.city,
          deliveryStateSnapshot: address.state,
          deliveryPostalCodeSnapshot: address.postalCode,
          deliveryLatitudeSnapshot: address.latitude,
          deliveryLongitudeSnapshot: address.longitude,
        };
        deliveryFee = quote.finalDeliveryFee;
        deliveryDistanceKm = quote.distanceKm;
        quotedEtaMinutes = quote.estimatedDurationMinutes;
      }

      const totalAmount = prepared.medicineSubtotal.add(deliveryFee);
      const order = await tx.order.create({
        data: {
          orderNumber,
          customerId,
          pharmacyId: currentCart.pharmacyId as string,
          fulfillmentMethod: input.fulfillmentMethod,
          status: prepared.status,
          ...addressSnapshots,
          medicineSubtotal: prepared.medicineSubtotal,
          deliveryFee,
          totalAmount,
          deliveryDistanceKm,
          quotedEtaMinutes,
          items: {
            create: prepared.items.map((item) => ({
              medicineId: item.medicineId,
              medicineNameSnapshot: item.medicineNameSnapshot,
              brandNameSnapshot: item.brandNameSnapshot,
              manufacturerSnapshot: item.manufacturerSnapshot,
              requiresPrescription: item.requiresPrescription,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
            })),
          },
        },
        select: orderSelect,
      });

      if (quote) {
        const attached = await tx.deliveryQuote.updateMany({
          where: {
            id: quote.id,
            customerId,
            pharmacyId: currentCart.pharmacyId as string,
            deliveryAddressId: currentCart.deliveryAddressId,
            orderId: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          data: { orderId: order.id },
        });
        if (attached.count !== 1) {
          const latest = await tx.deliveryQuote.findUnique({
            where: { id: quote.id },
            select: {
              id: true,
              customerId: true,
              pharmacyId: true,
              deliveryAddressId: true,
              orderId: true,
              finalDeliveryFee: true,
              distanceKm: true,
              estimatedDurationMinutes: true,
              expiresAt: true,
            },
          });
          validateQuote(
            latest,
            customerId,
            currentCart.pharmacyId as string,
            currentCart.deliveryAddressId as string,
            now,
          );
          throw deliveryQuoteAlreadyUsedError();
        }
      }

      const checkedOut = await tx.cart.updateMany({
        where: {
          id: currentCart.id,
          customerId,
          status: CartStatus.ACTIVE,
          pharmacyId: currentCart.pharmacyId,
          fulfillmentMethod: currentCart.fulfillmentMethod,
          items: { some: {} },
        },
        data: { status: CartStatus.CHECKED_OUT },
      });
      if (checkedOut.count !== 1) throw checkoutConflictError();

      return order;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function createCustomerOrder(
  customerId: string,
  input: CreateOrderInput,
  dataSource: OrderDataSource = prisma,
  inventoryReader: InventorySnapshotReader = getOrderableInventorySnapshot,
  medicineReader: MedicineDetailReader = getMedicineDetail,
  orderNumberGenerator: OrderNumberGenerator = generateOrderNumber,
  clock: CheckoutClock = () => new Date(),
): Promise<CreatedOrder> {
  for (let attempt = 1; attempt <= MAX_CHECKOUT_ATTEMPTS; attempt += 1) {
    const prepared = await prepareCheckout(
      customerId,
      input,
      dataSource,
      inventoryReader,
      medicineReader,
    );
    const now = clock();
    const orderNumber = orderNumberGenerator(now);

    try {
      return await createOrderAttempt(
        customerId,
        input,
        prepared,
        orderNumber,
        now,
        dataSource,
      );
    } catch (error) {
      if (!isRetryableCheckoutConflict(error)) throw error;
      if (attempt === MAX_CHECKOUT_ATTEMPTS) throw checkoutConflictError();
    }
  }

  throw checkoutConflictError();
}
