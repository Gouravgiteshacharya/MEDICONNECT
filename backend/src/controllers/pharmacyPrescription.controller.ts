import type { Request, Response } from "express";
import {
  getPharmacyPrescription,
  listPharmacyPrescriptions,
} from "../services/pharmacyPrescription.service.js";
import type { PharmacyPrescriptionListQuery } from "../validators/pharmacyPrescription.schemas.js";

export async function listPrescriptions(req: Request, res: Response) {
  const result = await listPharmacyPrescriptions(
    req.user!.id,
    req.params.pharmacyId as string,
    req.query as unknown as PharmacyPrescriptionListQuery,
  );
  res.status(200).json(result);
}

export async function getPrescription(req: Request, res: Response) {
  const prescription = await getPharmacyPrescription(
    req.user!.id,
    req.params.pharmacyId as string,
    req.params.prescriptionId as string,
  );
  res.status(200).json({ prescription });
}
