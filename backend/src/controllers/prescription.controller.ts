import type { Request, Response } from "express";

import {
  createCustomerPrescription,
  listCustomerPrescriptions,
} from "../services/prescription.service.js";
import { ApiError } from "../utils/ApiError.js";

function getAuthenticatedCustomerId(req: Request) {
  const customerId = req.user?.id;

  if (!customerId) {
    throw new ApiError(401, "Authentication required.", "AUTH_REQUIRED");
  }

  return customerId;
}

export async function createPrescription(req: Request, res: Response) {
  const prescription = await createCustomerPrescription(
    getAuthenticatedCustomerId(req),
    req.params.orderId as string,
    req.body,
  );

  res.status(201).json({ prescription });
}

export async function listPrescriptions(req: Request, res: Response) {
  const prescriptions = await listCustomerPrescriptions(
    getAuthenticatedCustomerId(req),
    req.params.orderId as string,
  );

  res.status(200).json({ prescriptions });
}
