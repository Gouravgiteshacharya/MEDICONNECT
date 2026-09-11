import type { Request, Response } from "express";

import {
  getMedicineDetail,
  listMedicines,
} from "../services/medicine.service.js";
import type { MedicineListQuery } from "../validators/medicine.schemas.js";

export async function getMedicines(req: Request, res: Response) {
  const result = await listMedicines(req.query as unknown as MedicineListQuery);
  res.status(200).json(result);
}

export async function getMedicine(req: Request, res: Response) {
  const medicine = await getMedicineDetail(req.params.medicineId as string);
  res.status(200).json({ medicine });
}
