import type { Request, Response } from "express";

import { createCustomerOrder } from "../services/order.service.js";
import { ApiError } from "../utils/ApiError.js";

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
