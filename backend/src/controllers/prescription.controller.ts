import type { Request, Response } from "express";

import {
  createPrescriptionDocumentAccess,
  createCustomerPrescription,
  getCustomerPrescription,
  listCustomerPrescriptionLibrary,
  listCustomerPrescriptions,
} from "../services/prescription.service.js";
import { ApiError } from "../utils/ApiError.js";
import type { PrescriptionLibraryQuery } from "../validators/prescription.schemas.js";

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
    { ...req.body, file: req.file },
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

export async function listPrescriptionLibrary(req: Request, res: Response) {
  const result = await listCustomerPrescriptionLibrary(
    getAuthenticatedCustomerId(req),
    req.query as unknown as PrescriptionLibraryQuery,
  );
  res.status(200).json(result);
}

export async function getPrescription(req: Request, res: Response) {
  const prescription = await getCustomerPrescription(
    getAuthenticatedCustomerId(req),
    req.params.prescriptionId as string,
  );
  res.status(200).json({ prescription });
}

export async function getPrescriptionDocumentAccess(
  req: Request,
  res: Response,
) {
  if (!req.user) {
    throw new ApiError(401, "Authentication required.", "AUTH_REQUIRED");
  }
  const documentAccess = await createPrescriptionDocumentAccess(
    req.user.id,
    req.user.role,
    req.params.prescriptionId as string,
  );
  res.status(200).json({ documentAccess });
}
