import type { Request, Response } from "express";

import {
  decidePharmacyOrder,
  reviewPharmacyPrescription,
} from "../services/pharmacyWorkflow.service.js";
import { ApiError } from "../utils/ApiError.js";

function getAuthenticatedStaffId(req: Request) {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, "Authentication required.", "AUTH_REQUIRED");
  }
  return userId;
}

export async function reviewPrescription(req: Request, res: Response) {
  const prescription = await reviewPharmacyPrescription(
    getAuthenticatedStaffId(req),
    req.params.pharmacyId as string,
    req.params.prescriptionId as string,
    req.body,
  );
  res.status(200).json({ prescription });
}

export async function decideOrder(req: Request, res: Response) {
  const order = await decidePharmacyOrder(
    getAuthenticatedStaffId(req),
    req.params.pharmacyId as string,
    req.params.orderId as string,
    req.body,
  );
  res.status(200).json({ order });
}
