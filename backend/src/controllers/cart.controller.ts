import type { Request, Response } from "express";

import {
  getActiveCustomerCart,
  removeActiveCartItem,
  updateActiveCartItemQuantity,
} from "../services/cart.service.js";
import { ApiError } from "../utils/ApiError.js";

function getAuthenticatedCustomerId(req: Request) {
  const customerId = req.user?.id;

  if (!customerId) {
    throw new ApiError(401, "Authentication required.", "AUTH_REQUIRED");
  }

  return customerId;
}

function getItemId(req: Request) {
  const { itemId } = req.params;

  return Array.isArray(itemId) ? itemId[0] : itemId;
}

export async function getCart(req: Request, res: Response) {
  const cart = await getActiveCustomerCart(getAuthenticatedCustomerId(req));

  res.status(200).json({ cart });
}

export async function updateCartItem(req: Request, res: Response) {
  const item = await updateActiveCartItemQuantity(
    getAuthenticatedCustomerId(req),
    getItemId(req),
    req.body.quantity,
  );

  res.status(200).json({ item });
}

export async function deleteCartItem(req: Request, res: Response) {
  await removeActiveCartItem(
    getAuthenticatedCustomerId(req),
    getItemId(req),
  );

  res.status(204).send();
}
