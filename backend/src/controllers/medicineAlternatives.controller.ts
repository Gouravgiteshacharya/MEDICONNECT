import type { Request, Response } from "express";

import { getCompositionBasedAlternatives } from "../services/medicineAlternatives.service.js";
import type { MedicineAlternativesQuery } from "../validators/medicineAlternatives.schemas.js";

export async function getMedicineAlternatives(req: Request, res: Response) {
  const result = await getCompositionBasedAlternatives(
    req.params.medicineId as string,
    req.query as unknown as MedicineAlternativesQuery,
  );
  res.status(200).json(result);
}
