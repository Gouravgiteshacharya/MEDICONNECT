import type { Request, Response } from "express";

import { getNearbyMedicineAvailability } from "../services/medicineAvailability.service.js";
import type { MedicineAvailabilityQuery } from "../validators/medicineAvailability.schemas.js";

export async function getMedicineAvailability(req: Request, res: Response) {
  const result = await getNearbyMedicineAvailability(
    req.params.medicineId as string,
    req.query as unknown as MedicineAvailabilityQuery,
  );
  res.status(200).json(result);
}
