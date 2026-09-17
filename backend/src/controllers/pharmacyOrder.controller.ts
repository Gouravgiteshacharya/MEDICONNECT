import type { Request, Response } from "express";
import { getPharmacyOrder, listPharmacyOrders } from "../services/pharmacyOrder.service.js";
import type { PharmacyOrderListQuery } from "../validators/pharmacyOrder.schemas.js";

export async function listOrders(req: Request, res: Response) {
  const result = await listPharmacyOrders(
    req.user!.id,
    req.params.pharmacyId as string,
    req.query as unknown as PharmacyOrderListQuery,
  );
  res.status(200).json(result);
}

export async function getOrder(req: Request, res: Response) {
  const order = await getPharmacyOrder(
    req.user!.id,
    req.params.pharmacyId as string,
    req.params.orderId as string,
  );
  res.status(200).json({ order });
}
