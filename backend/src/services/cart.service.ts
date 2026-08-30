import { CartStatus } from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";

type CartItemRecord = {
  id: string;
  medicineId: string;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
  medicine: {
    id: string;
    name: string;
    brandName: string | null;
    genericName: string | null;
    manufacturer: string | null;
    requiresPrescription: boolean;
  };
};

type CartRecord = {
  id: string;
  pharmacyId: string | null;
  deliveryAddressId: string | null;
  fulfillmentMethod: "DELIVERY" | "SELF_PICKUP" | null;
  status: CartStatus;
  createdAt: Date;
  updatedAt: Date;
  items: CartItemRecord[];
};

type CartSelect = {
  id: true;
  pharmacyId: true;
  deliveryAddressId: true;
  fulfillmentMethod: true;
  status: true;
  createdAt: true;
  updatedAt: true;
  items: {
    select: CartItemSelect;
    orderBy: { createdAt: "asc" };
  };
};

type CartItemSelect = {
  id: true;
  medicineId: true;
  quantity: true;
  createdAt: true;
  updatedAt: true;
  medicine: {
    select: {
      id: true;
      name: true;
      brandName: true;
      genericName: true;
      manufacturer: true;
      requiresPrescription: true;
    };
  };
};

export type CartDataSource = {
  cart: {
    findFirst(args: {
      where: { customerId: string; status: CartStatus };
      select: CartSelect;
      orderBy: { createdAt: "asc" };
    }): Promise<CartRecord | null>;
  };
  cartItem: {
    updateManyAndReturn(args: {
      where: {
        id: string;
        cart: { customerId: string; status: CartStatus };
      };
      data: { quantity: number };
      select: CartItemSelect;
    }): Promise<CartItemRecord[]>;
    deleteMany(args: {
      where: {
        id: string;
        cart: { customerId: string; status: CartStatus };
      };
    }): Promise<{ count: number }>;
  };
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
} satisfies CartItemSelect;

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
} satisfies CartSelect;

function cartItemNotFoundError() {
  return new ApiError(404, "Cart item not found.", "CART_ITEM_NOT_FOUND");
}

export async function getActiveCustomerCart(
  customerId: string,
  dataSource: CartDataSource = prisma,
): Promise<CartRecord | null> {
  return dataSource.cart.findFirst({
    where: {
      customerId,
      status: CartStatus.ACTIVE,
    },
    select: cartSelect,
    orderBy: { createdAt: "asc" },
  });
}

export async function updateActiveCartItemQuantity(
  customerId: string,
  itemId: string,
  quantity: number,
  dataSource: CartDataSource = prisma,
): Promise<CartItemRecord> {
  const [item] = await dataSource.cartItem.updateManyAndReturn({
    where: {
      id: itemId,
      cart: {
        customerId,
        status: CartStatus.ACTIVE,
      },
    },
    data: { quantity },
    select: cartItemSelect,
  });

  if (!item) {
    throw cartItemNotFoundError();
  }

  return item;
}

export async function removeActiveCartItem(
  customerId: string,
  itemId: string,
  dataSource: CartDataSource = prisma,
): Promise<void> {
  const result = await dataSource.cartItem.deleteMany({
    where: {
      id: itemId,
      cart: {
        customerId,
        status: CartStatus.ACTIVE,
      },
    },
  });

  if (result.count === 0) {
    throw cartItemNotFoundError();
  }
}
