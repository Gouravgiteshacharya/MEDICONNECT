import type { Request, Response } from "express";

import { getPharmacyDashboard } from "../services/pharmacyDashboard.service.js";

export async function getDashboard(req: Request, res: Response) {
  const result = await getPharmacyDashboard(
    req.user!.id,
    req.params.pharmacyId as string,
  );
  res.status(200).json(result);
}
