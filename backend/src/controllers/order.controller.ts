import type { Request, Response } from "express";

import {
  createCustomerOrder,
  getCustomerOrder,
  listCustomerOrders,
} from "../services/order.service.js";
import { ApiError } from "../utils/ApiError.js";
import type { OrderHistoryQuery } from "../validators/order.schemas.js";

function getAuthenticatedCustomerId(req: Request) {
  const customerId = req.user?.id;

  if (!customerId) {
    throw new ApiError(401, "Authentication required.", "AUTH_REQUIRED");
  }

  return customerId;
}

export async function createOrder(req: Request, res: Response) {
  const order = await createCustomerOrder(
    getAuthenticatedCustomerId(req),
    req.body,
  );

  res.status(201).json({ order });
}

export async function listOrders(req: Request, res: Response) {
  const result = await listCustomerOrders(
    getAuthenticatedCustomerId(req),
    req.query as unknown as OrderHistoryQuery,
  );

  res.status(200).json(result);
}

export async function getOrder(req: Request, res: Response) {
  const order = await getCustomerOrder(
    getAuthenticatedCustomerId(req),
    req.params.orderId as string,
  );

  res.status(200).json({ order });
}
